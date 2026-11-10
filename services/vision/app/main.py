"""Stocklane Vision on Lambda: photo matching, label drafts and reference photos.

Sign-in is checked by the API Gateway JWT authorizer; this code checks the role from the verified token.
Nothing here posts stock: every match and draft is a suggestion a person confirms.
"""
import asyncio
import hashlib
import json
import logging
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import boto3
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from . import dataset_export, model, textract
from .bedrock import PROMPT_VERSION, BedrockUnavailable, failure, propose
from .config import Settings
from .qr import product_qr
from .storage import Store

DRAFT_FIELDS = ('name', 'brand', 'partNumber', 'category', 'grade', 'capacity')
log = logging.getLogger('stocklane.vision')
settings = Settings()
store = Store(settings) if settings.table else None


def staff(request: Request, owner=False):
    claims = ((request.scope.get('aws.event') or {}).get('requestContext', {}).get('authorizer', {}).get('jwt', {}) or {}).get('claims', {}) or {}
    groups = {g for g in re.split(r'[\s,\[\]]+', str(claims.get('cognito:groups', ''))) if g}
    if owner and 'OWNER' not in groups:
        raise HTTPException(403, 'Owner access is required')
    if not groups.intersection({'OWNER', 'MECHANIC'}):
        raise HTTPException(403, 'Staff access is required')
    return claims.get('username') or claims.get('sub') or 'unknown'


def embedding(image):
    encoder = model.encoder(settings)
    if encoder is None:
        raise HTTPException(503, 'The photo model is not released yet. Run Deploy, then try again.')
    return encoder, encoder.encode(image)


def index_product(product, image_id=None):
    encoder, vector = embedding(store.image(image_id or product['image_id']))
    store.index({**product, 'id': product['id']}, image_id or product['image_id'], encoder.version, vector)


def reconcile():
    """Give every confirmed photo a vector for the current model. Safe to repeat."""
    encoder = model.encoder(settings)
    if encoder is None:
        return {'indexed': 0, 'modelVersion': None}
    done, count = store.indexed_keys(encoder.version), 0
    wanted = {}
    for p in store.products_with_photos():
        wanted[p['id'] + '#' + p['image_id']] = (p, p['image_id'])
    for ref in store.references():
        product = store.product(ref['product_id'])
        if product and not product.get('archived'):
            wanted.setdefault(ref['sk'], (product, ref['image_id']))
    for key, (product, image_id) in wanted.items():
        if key not in done:
            try:
                index_product(product, image_id)
                count += 1
            except (FileNotFoundError, ValueError):
                log.warning('Photo skipped during reindex: %s', key)
    return {'indexed': count, 'modelVersion': encoder.version}


def weekly_export():
    if not settings.model_bucket:
        return {'exported': False, 'reason': 'No models bucket'}
    return dataset_export.export(store, boto3.client('s3'), settings.model_bucket)


def create_app():
    app = FastAPI(title='Stocklane Vision', docs_url=None, openapi_url=None, redoc_url=None)

    @app.get('/api/vision/status')
    def status(request: Request):
        staff(request)
        encoder = model.encoder(settings)
        return {'modelReady': encoder is not None, 'modelVersion': encoder.version if encoder else None,
                'workshopCalibrated': bool(encoder and encoder.manifest.get('workshopCalibrated')),
                'bedrockConfigured': bool(settings.bedrock_model_id), 'bedrockModelId': settings.bedrock_model_id or None,
                'bedrockRegion': (settings.bedrock_region or settings.aws_region) if settings.bedrock_model_id else None,
                'automaticPosting': False, 'mode': 'cognito'}

    @app.post('/api/vision/qr')
    async def read_qr(request: Request, file: UploadFile = File(...)):
        staff(request)
        data = await file.read(settings.max_upload_bytes + 1)
        if len(data) > settings.max_upload_bytes:
            raise HTTPException(413, 'Image exceeds the upload limit')
        try:
            return {'value': await asyncio.to_thread(product_qr, data)}
        except (ValueError, OSError):
            raise HTTPException(422, 'Use a clear photo with a valid Lifta QR') from None

    @app.get('/api/vision/barcodes/{barcode}')
    def barcode_lookup(barcode: str, request: Request):
        """External barcode metadata as an optional suggestion that a person reviews."""
        staff(request)
        value = barcode.strip()
        if not value.isdigit() or not 8 <= len(value) <= 14:
            raise HTTPException(422, 'Enter a valid product barcode')
        try:
            req = urllib.request.Request('https://world.openfoodfacts.org/api/v2/product/' + urllib.parse.quote(value) + '.json',
                                         headers={'User-Agent': 'Stocklane/1.0 (barcode lookup)'})
            with urllib.request.urlopen(req, timeout=5) as response:
                payload = json.loads(response.read(1024 * 1024))
        except (urllib.error.URLError, ValueError, TimeoutError):
            raise HTTPException(503, 'External barcode information is unavailable; enter the item manually.') from None
        product = payload.get('product') if payload.get('status') == 1 else None
        if not product:
            return {'barcode': value, 'found': False, 'suggestions': {}}
        return {'barcode': value, 'found': True, 'suggestions': {k: product[k] for k in ('product_name', 'brands', 'categories', 'quantity') if product.get(k)}}

    @app.post('/api/vision/match')
    async def match(request: Request, file: UploadFile = File(...)):
        staff(request)
        data = await file.read(settings.max_upload_bytes + 1)
        if len(data) > settings.max_upload_bytes:
            raise HTTPException(413, 'Image exceeds the upload limit')
        try:
            image_id = await asyncio.to_thread(store.save_image, data)
            image = await asyncio.to_thread(store.image, image_id)
            encoder, vector = await asyncio.to_thread(embedding, image)
            candidates = await asyncio.to_thread(store.candidates, encoder.version, vector)
            candidates = [c for c in candidates if encoder.accepts(c['similarity'], settings.match_threshold)]
            for c in candidates:
                c['sameSkuEstimate'] = encoder.same_sku_estimate(c['similarity'])
        except HTTPException:
            raise
        except (ValueError, OSError):
            raise HTTPException(422, 'Use a clear JPEG or PNG photo of one item') from None
        return {'imageId': image_id, 'state': 'REVIEW' if candidates else 'UNKNOWN', 'modelVersion': encoder.version,
                'candidates': candidates, 'autoPostEligible': False,
                'message': 'Check brand, grade and capacity before confirming.' if candidates else 'No approved reference match yet. Create a review draft.'}

    @app.get('/api/vision/images/{image_id}')
    def image(image_id: str, request: Request):
        staff(request)
        try:
            return Response(store.image(image_id), media_type='image/jpeg', headers={'Cache-Control': 'private, max-age=300'})
        except (ValueError, FileNotFoundError):
            raise HTTPException(404, 'Image not found') from None

    class ReferenceInput(BaseModel):
        productId: str
        imageId: str

    def verified_product(product_id):
        product = store.product(product_id)
        if not product:
            raise HTTPException(404, 'Approved product not found')
        if product.get('archived'):
            raise HTTPException(409, 'Product is archived')
        return product

    @app.post('/api/vision/references')
    def reference(request: Request, body: ReferenceInput):
        staff(request)
        product = verified_product(body.productId)
        try:
            index_product(product, body.imageId)
        except (ValueError, FileNotFoundError):
            raise HTTPException(404, 'Photo not found') from None
        return {'indexed': True, 'modelVersion': model.encoder(settings).version}

    class DraftInput(BaseModel):
        imageId: str

    @app.post('/api/vision/drafts')
    def draft(request: Request, body: DraftInput):
        actor = staff(request)
        try:
            image_bytes = store.image(body.imageId)
        except (ValueError, FileNotFoundError):
            raise HTTPException(404, 'Photo not found') from None
        fields, source, suggestions, ai = {}, 'manual', {}, {'status': 'not_configured'}
        if settings.textract_fallback:
            try:
                fields = textract.propose(settings, image_bytes) or {}
            except Exception as error:
                log.warning('Label reading failed type=%s', type(error).__name__)
            if fields:
                source = textract.SOURCE
        problem = None
        missing = [n for n in DRAFT_FIELDS if n not in fields]
        if settings.bedrock_model_id and not missing:
            ai = {'status': 'not_needed'}
        if settings.bedrock_model_id and missing:
            used = store.spend_allowance()
            if used > settings.bedrock_daily_request_limit:
                if not fields:
                    raise HTTPException(429, 'Daily AI suggestion limit reached. Register manually or retry tomorrow UTC.')
                ai = {'status': 'limit_reached'}
            else:
                try:
                    proposed, _ = propose(settings, image_bytes, fields)
                    suggestions = {k: v for k, v in proposed.items() if k in DRAFT_FIELDS and k not in fields and v}
                    ai = {'status': 'used'}
                    if not fields:
                        source = 'bedrock'
                except Exception as error:
                    problem = error if isinstance(error, BedrockUnavailable) else failure(error)
                    ai = {'status': 'unavailable', 'code': problem.code, 'message': problem.message.split('. ')[0]}
                    log.warning('AI suggestions unavailable code=%s', problem.code)
        if problem and not fields:
            return JSONResponse(status_code=problem.status, content={'detail': problem.message, 'code': problem.code, 'retryable': problem.retryable},
                                headers={'Retry-After': str(problem.retry_after)} if problem.retry_after else {})
        label_suggestions = dict(fields)  # label text and model output are suggestions; the form starts empty
        row = {'id': str(uuid.uuid4()), 'image_id': body.imageId, 'fields': '{}', 'source': source, 'status': 'PENDING',
               'created_at': datetime.now(timezone.utc).isoformat(), 'actor': actor, 'product_id': None}
        store.add_draft({k: v for k, v in row.items() if v is not None})
        return dict(row, fields={}, suggestions=suggestions, labelSuggestions=label_suggestions, ai=ai)

    @app.get('/api/vision/drafts')
    def drafts(request: Request):
        staff(request)
        return [dict(d, fields=json.loads(d.get('fields') or '{}'), product_id=d.get('product_id')) for d in store.drafts()]

    class Resolution(BaseModel):
        status: str
        productId: str | None = None

    @app.patch('/api/vision/drafts/{draft_id}')
    def resolve(draft_id: str, body: Resolution, request: Request):
        staff(request)
        if body.status not in {'APPROVED', 'REJECTED'}:
            raise HTTPException(400, 'Invalid draft resolution')
        row = store.draft(draft_id)
        if not row:
            raise HTTPException(404, 'Draft not found')
        if row['status'] != 'PENDING':
            if row['status'] == body.status and row.get('product_id') == body.productId:
                return {'status': body.status}
            raise HTTPException(409, 'This draft was already resolved')
        if body.status == 'APPROVED':
            if not body.productId:
                raise HTTPException(400, 'An approved product is required')
            index_product(verified_product(body.productId), row['image_id'])  # only a person-approved item is linked
        store.resolve_draft(draft_id, body.status, body.productId)
        return {'status': body.status}

    return app
