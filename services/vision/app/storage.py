"""Photos in S3; reference vectors, drafts and counters in the shared DynamoDB table.

REF#<model version>/<product>#<image>  one vector per confirmed photo (float32 bytes)
REFS/<product>#<image>                 the same photo without a vector (all versions share it)
DRAFT/<id>                             AI/label drafts waiting for a person
"""
import hashlib
import io
import json
import re
import time
from datetime import datetime, timezone
from decimal import Decimal

import boto3
import numpy as np
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.types import Binary

FIELDS = ['id', 'sku', 'name', 'category', 'brand', 'grade', 'capacity', 'barcode', 'unit', 'image_id']


class Store:
    def __init__(self, settings):
        self.s = settings
        self.table = boto3.resource('dynamodb').Table(settings.table)
        self.s3 = boto3.client('s3')
        self._vectors = {}

    # ---------- photos ----------
    def save_image(self, data):
        from .encoder import decode
        im = decode(data)
        im.thumbnail((1600, 1600))
        out = io.BytesIO()
        im.save(out, format='JPEG', quality=94)
        normalized = out.getvalue()
        image_id = hashlib.sha256(normalized).hexdigest() + '.jpg'
        self.s3.put_object(Bucket=self.s.media_bucket, Key='images/' + image_id, Body=normalized, ContentType='image/jpeg')
        return image_id

    def image(self, image_id):
        if not re.fullmatch(r'[a-f0-9]{64}\.jpg', image_id):
            raise ValueError('Invalid image reference')
        try:
            return self.s3.get_object(Bucket=self.s.media_bucket, Key='images/' + image_id)['Body'].read()
        except self.s3.exceptions.NoSuchKey:
            raise FileNotFoundError(image_id) from None

    # ---------- catalogue (owned by the API function, read here) ----------
    def product(self, product_id):
        return self.table.get_item(Key={'pk': 'PRODUCT', 'sk': str(product_id)}).get('Item')

    def products_with_photos(self):
        items, start = [], None
        while True:
            args = {'KeyConditionExpression': Key('pk').eq('PRODUCT')}
            if start:
                args['ExclusiveStartKey'] = start
            page = self.table.query(**args)
            items += [p for p in page['Items'] if p.get('image_id') and not p.get('archived')]
            start = page.get('LastEvaluatedKey')
            if not start:
                return items

    def catalogue_values(self, limit=60):
        """The shop's own categories and brands (most used first), so suggestions reuse the same names."""
        from collections import Counter
        categories, brands, start = Counter(), Counter(), None
        while True:
            args = {'KeyConditionExpression': Key('pk').eq('PRODUCT')}
            if start:
                args['ExclusiveStartKey'] = start
            page = self.table.query(**args)
            for p in page['Items']:
                if p.get('archived'):
                    continue
                if p.get('category'):
                    categories[str(p['category']).strip()] += 1
                if p.get('brand'):
                    brands[str(p['brand']).strip()] += 1
            start = page.get('LastEvaluatedKey')
            if not start:
                return [c for c, _ in categories.most_common(limit)], [b for b, _ in brands.most_common(limit)]

    # ---------- references ----------
    def index(self, product, image_id, version, embedding):
        card = {k: product.get(k) for k in FIELDS}
        key = product['id'] + '#' + image_id
        blob = Binary(np.asarray(embedding, dtype=np.float32).tobytes())
        encoded = json.dumps(card, default=str)
        with self.table.batch_writer() as batch:
            batch.put_item(Item={'pk': 'REF#' + version, 'sk': key, 'product_id': product['id'], 'image_id': image_id,
                                 'embedding': blob, 'product': encoded})
            batch.put_item(Item={'pk': 'REFS', 'sk': key, 'product_id': product['id'], 'image_id': image_id, 'product': encoded})
        self._vectors.pop(version, None)

    def references(self):
        items, start = [], None
        while True:
            args = {'KeyConditionExpression': Key('pk').eq('REFS')}
            if start:
                args['ExclusiveStartKey'] = start
            page = self.table.query(**args)
            items += page['Items']
            start = page.get('LastEvaluatedKey')
            if not start:
                return items

    def indexed_keys(self, version):
        items, start = set(), None
        while True:
            args = {'KeyConditionExpression': Key('pk').eq('REF#' + version), 'ProjectionExpression': 'sk'}
            if start:
                args['ExclusiveStartKey'] = start
            page = self.table.query(**args)
            items |= {i['sk'] for i in page['Items']}
            start = page.get('LastEvaluatedKey')
            if not start:
                return items

    def _load(self, version):
        cached = self._vectors.get(version)
        if cached and time.monotonic() < cached[0]:
            return cached[1]
        rows, start = [], None
        while True:
            args = {'KeyConditionExpression': Key('pk').eq('REF#' + version)}
            if start:
                args['ExclusiveStartKey'] = start
            page = self.table.query(**args)
            rows += page['Items']
            start = page.get('LastEvaluatedKey')
            if not start:
                break
        matrix = np.vstack([np.frombuffer(bytes(r['embedding']), dtype=np.float32) for r in rows]) if rows else np.zeros((0, 1280), np.float32)
        self._vectors[version] = (time.monotonic() + 120, (rows, matrix))
        return rows, matrix

    def candidates(self, version, embedding):
        rows, matrix = self._load(version)
        if not len(rows):
            return []
        scores = matrix @ np.asarray(embedding, dtype=np.float32)
        best = {}
        for index in np.argsort(-scores)[:20]:
            row = rows[int(index)]
            if row['product_id'] not in best:
                best[row['product_id']] = {'product': json.loads(row['product']), 'imageId': row['image_id'],
                                           'similarity': round(float(scores[index]), 4)}
        return list(best.values())[:5]

    # ---------- drafts and the daily AI allowance ----------
    def add_draft(self, row):
        self.table.put_item(Item={'pk': 'DRAFT', 'sk': row['id'], **row, 'ttl': int(time.time()) + 180 * 86400})

    def drafts(self):
        items, start = [], None
        while True:
            args = {'KeyConditionExpression': Key('pk').eq('DRAFT')}
            if start:
                args['ExclusiveStartKey'] = start
            page = self.table.query(**args)
            items += page['Items']
            start = page.get('LastEvaluatedKey')
            if not start:
                break
        items.sort(key=lambda d: d['created_at'], reverse=True)
        return [{k: v for k, v in d.items() if k not in ('pk', 'sk', 'ttl')} for d in items[:100]]

    def draft(self, draft_id):
        return self.table.get_item(Key={'pk': 'DRAFT', 'sk': draft_id}).get('Item')

    def resolve_draft(self, draft_id, status, product_id):
        self.table.update_item(Key={'pk': 'DRAFT', 'sk': draft_id}, UpdateExpression='SET #s = :s, product_id = :p',
                               ExpressionAttributeNames={'#s': 'status'}, ExpressionAttributeValues={':s': status, ':p': product_id})

    def spend_allowance(self):
        """Count one AI request for today (UTC); returns how many were used including this one."""
        day = datetime.now(timezone.utc).strftime('%Y-%m-%d')
        result = self.table.update_item(Key={'pk': 'LIMIT', 'sk': day}, UpdateExpression='ADD used :one SET #ttl = :t',
                                        ExpressionAttributeNames={'#ttl': 'ttl'},  # TTL is a DynamoDB reserved word
                                        ExpressionAttributeValues={':one': Decimal(1), ':t': int(time.time()) + 172800},
                                        ReturnValues='UPDATED_NEW')
        return int(result['Attributes']['used'])
