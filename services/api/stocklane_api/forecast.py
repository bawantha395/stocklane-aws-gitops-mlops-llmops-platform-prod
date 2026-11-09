"""Forecast read model: the nightly forecast file in S3 joined with live stock."""
import json
import math
import os
import time
from datetime import date, datetime, timedelta, timezone

import boto3
from botocore.exceptions import ClientError

from .core import COLOMBO, dumps
from . import inventory

USABLE = {'forecast', 'not_moving'}
KNOWN = USABLE | {'needs_more_history', 'unreliable'}
_cache = {'until': 0, 'value': None}


def projection(model, products, today=None):
    """Items without a usable forecast are still listed, with their reorder level, so the app always has an answer."""
    today = today or datetime.now(COLOMBO).date()
    state, forecasts, result = 'not_trained', {}, {}
    if model:
        if model.get('schemaVersion') != 1 or model.get('task') != 'stock_usage_forecast':
            raise ValueError('Invalid forecast schema')
        end = date.fromisoformat(model['historyUntil'])
        if datetime.fromisoformat(model['generatedAt'].replace('Z', '+00:00')) > datetime.now(timezone.utc) + timedelta(minutes=5):
            raise ValueError('Future model timestamp')
        if today - timedelta(days=7) <= end <= today:
            state, forecasts = 'fresh', {p['id']: p for p in model['products']}
            result.update(generatedAt=model['generatedAt'], historyUntil=model['historyUntil'],
                          datasetSha256=model['datasetSha256'], model=model.get('model'))
        else:
            state = 'stale'
    rows = []
    for item in products:
        row = {k: item.get(k) for k in ('id', 'sku', 'name', 'unit')}
        row['availableNow'] = float(item['quantity'])
        row['reorderLevel'] = float(item.get('reorder_level') or 0)
        forecast = forecasts.get(item['id'])
        if forecast and forecast['status'] not in KNOWN:
            raise ValueError('Unknown forecast status')
        if not forecast or forecast['status'] not in USABLE:
            row.update(status=forecast['status'] if forecast else 'no_forecast',
                       message=forecast['message'] if forecast else 'No forecast yet; the reorder level is used.')
            rows.append(row)
            continue
        selected = {date.fromisoformat(d['date']): float(d['quantity']) for d in forecast['daily']}
        days = [today + timedelta(days=i) for i in range(30)]
        if any(d not in selected or not math.isfinite(selected[d]) or selected[d] < 0 for d in days):
            raise ValueError('Incomplete forecast horizon')
        next7, next30 = sum(selected[d] for d in days[:7]), sum(selected[d] for d in days)
        topup = max(0, next7 - row['availableNow'])
        row.update(status=forecast['status'], message=forecast['message'], historyDays=forecast['historyDays'],
                   next7=round(next7, 3), next30=round(next30, 3),
                   suggestedTopUp7=math.ceil(topup) if item['unit'] == 'UNIT' else math.ceil(topup * 1000) / 1000)
        rows.append(row)
    return {'status': 'ready', 'forecast': state, 'products': rows, **result}


def read_model():
    bucket = os.environ.get('MODEL_BUCKET')
    if not bucket:
        return None
    if time.monotonic() > _cache['until']:
        try:
            body = boto3.client('s3').get_object(Bucket=bucket, Key='forecast/current.json')['Body']
            raw = body.read(12 * 1024 * 1024 + 1)
            if len(raw) > 12 * 1024 * 1024:
                raise ValueError('Forecast artifact too large')
            _cache.update(value=json.loads(raw), until=time.monotonic() + 60)
        except ClientError as error:
            if error.response['Error']['Code'] not in {'NoSuchKey', '404', 'AccessDenied'}:
                raise
            _cache.update(value=None, until=time.monotonic() + 60)
    return _cache['value']


def current():
    return projection(read_model(), inventory.active_products())


def export_history(who='nightly-export'):
    """Write the exported history the forecast job reads. Content-addressed, so reruns are harmless."""
    import hashlib
    from .core import table, query
    bucket = os.environ.get('MODEL_BUCKET')
    if not bucket:
        return {'exported': False, 'reason': 'No model bucket configured'}
    first = query('DAY', limit=1)
    today = datetime.now(COLOMBO).date()
    if not first:
        return {'exported': False, 'reason': 'No stock movements yet'}
    start = max(date.fromisoformat(first[0]['sk'][:10]), today - timedelta(days=1095))
    start = min(start, today)
    data = inventory.history_snapshot(start.isoformat(), True, who)
    raw = dumps(data).encode()
    if len(raw) > 12 * 1024 * 1024:
        raise ValueError('History snapshot is too large; choose a shorter period')
    digest = hashlib.sha256(raw).hexdigest()
    key = 'forecast/datasets/' + digest + '/history.json'
    s3 = boto3.client('s3')
    s3.put_object(Bucket=bucket, Key=key, Body=raw, ContentType='application/json')
    s3.put_object(Bucket=bucket, Key='forecast/datasets/latest.json', ContentType='application/json',
                  Body=dumps({'key': key, 'sha256': digest, 'asOf': data['asOf']}).encode())
    return {'exported': True, 'key': key}
