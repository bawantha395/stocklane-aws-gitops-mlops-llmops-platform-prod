"""Shared plumbing: DynamoDB access, JSON, errors, roles and idempotent commands."""
import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

COLOMBO = ZoneInfo('Asia/Colombo')
_resource = None


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status, self.message = status, message


def bad(message):
    return ApiError(400, message)


def conflict(message):
    return ApiError(409, message)


def missing(message):
    return ApiError(404, message)


class Retry(Exception):
    """A concurrent writer changed the data this command read; the command is rebuilt."""


def table():
    global _resource
    if _resource is None:
        _resource = boto3.resource('dynamodb').Table(os.environ['TABLE'])
    return _resource


def now():
    return datetime.now(timezone.utc).isoformat()


def num(value, field='Quantity'):
    """Parse a JSON number into Decimal without binary rounding."""
    if isinstance(value, bool) or value is None:
        raise bad(field + ' must be a number')
    try:
        result = Decimal(str(value))
    except Exception:
        raise bad(field + ' must be a number') from None
    if not result.is_finite():
        raise bad(field + ' must be a number')
    return result


def plain(value):
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, dict):
        return {k: plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [plain(v) for v in value]
    return value


def dumps(value, **kw):
    return json.dumps(plain(value), separators=(',', ':'), **kw)


def public(item, drop=('pk', 'sk', 'ttl')):
    return {k: v for k, v in item.items() if k not in drop}


# ---------- reads ----------
def get(pk, sk):
    return table().get_item(Key={'pk': pk, 'sk': sk}).get('Item')


def query(pk, **kw):
    """All items of one partition (pages followed). Optional sk range, direction and limit."""
    condition = Key('pk').eq(pk)
    if 'between' in kw:
        condition &= Key('sk').between(*kw.pop('between'))
    if 'gte' in kw:
        condition &= Key('sk').gte(kw.pop('gte'))
    if 'lt' in kw:
        condition &= Key('sk').lt(kw.pop('lt'))
    if 'prefix' in kw:
        condition &= Key('sk').begins_with(kw.pop('prefix'))
    limit = kw.pop('limit', None)
    forward = kw.pop('forward', True)
    items, start = [], None
    while True:
        args = {'KeyConditionExpression': condition, 'ScanIndexForward': forward}
        if start:
            args['ExclusiveStartKey'] = start
        if limit:
            args['Limit'] = limit - len(items)
        page = table().query(**args)
        items += page['Items']
        start = page.get('LastEvaluatedKey')
        if not start or (limit and len(items) >= limit):
            return items


def batch_get(keys):
    result = []
    for i in range(0, len(keys), 100):
        chunk = [{'pk': a, 'sk': b} for a, b in keys[i:i + 100]]
        name = table().name
        response = table().meta.client.batch_get_item(RequestItems={name: {'Keys': chunk}})
        result += response['Responses'][name]
    return result


# ---------- writes ----------
def put(item, **kw):
    return {'Put': {'TableName': table().name, 'Item': item, **kw}}


def update(pk, sk, expression, values, names=None, condition=None):
    op = {'TableName': table().name, 'Key': {'pk': pk, 'sk': sk}, 'UpdateExpression': expression,
          'ExpressionAttributeValues': values}
    if names:
        op['ExpressionAttributeNames'] = names
    if condition:
        op['ConditionExpression'] = condition
    return {'Update': op}


def check(pk, sk, condition, values=None, names=None):
    op = {'TableName': table().name, 'Key': {'pk': pk, 'sk': sk}, 'ConditionExpression': condition}
    if values:
        op['ExpressionAttributeValues'] = values
    if names:
        op['ExpressionAttributeNames'] = names
    return {'ConditionCheck': op}


def delete(pk, sk):
    return {'Delete': {'TableName': table().name, 'Key': {'pk': pk, 'sk': sk}}}


def unique(kind, value):
    """Claim a unique value (SKU, barcode, ...); fails the transaction when it is taken."""
    return put({'pk': 'UNIQ', 'sk': kind + '#' + value}, ConditionExpression='attribute_not_exists(pk)')


def transact(operations, labels):
    """Run a transaction. labels[i] is the message when operation i fails its condition."""
    try:
        table().meta.client.transact_write_items(TransactItems=operations)
    except ClientError as error:
        if error.response['Error']['Code'] != 'TransactionCanceledException':
            raise
        for index, reason in enumerate(error.response.get('CancellationReasons', [])):
            code = reason.get('Code')
            if code == 'ConditionalCheckFailed':
                message = labels[index] if index < len(labels) else None
                if message is None:
                    raise Retry() from None
                raise conflict(message) from None
            if code == 'TransactionConflict':
                raise Retry() from None
        raise


# ---------- roles ----------
def claims(event):
    return (event.get('requestContext', {}).get('authorizer', {}).get('jwt', {}) or {}).get('claims', {}) or {}


def groups(event):
    raw = claims(event).get('cognito:groups', '')
    if isinstance(raw, list):
        return set(raw)
    return {g for g in re.split(r'[\s,\[\]]+', str(raw)) if g}


def actor(event):
    c = claims(event)
    return c.get('username') or c.get('sub') or 'unknown'


def require(event, *roles):
    if not groups(event).intersection(roles):
        raise ApiError(403, 'You do not have access to this action')


# ---------- idempotent commands ----------
KEY = re.compile(r'[a-zA-Z0-9_-]{16,100}')


def command(key, operation, who, body, build):
    """Run build() once per Idempotency-Key. build returns (operations, labels, result);
    the command record joins the same transaction, so a replay never repeats the work."""
    if not key or not KEY.fullmatch(key):
        raise bad('A 16-100 character Idempotency-Key is required')
    digest = hashlib.sha256((operation + '|' + who + '|' + dumps(body, sort_keys=True)).encode()).hexdigest()

    def replay():
        stored = get('CMD', key)
        if not stored:
            return None
        if stored['hash'] != digest:
            raise conflict('This request key was already used for different data')
        return json.loads(stored['response'])

    for _ in range(4):
        done = replay()
        if done is not None:
            return done
        operations, labels, result = build()
        record = {'pk': 'CMD', 'sk': key, 'hash': digest, 'response': dumps(result), 'created_at': now(),
                  'ttl': int(time.time()) + 7 * 86400}
        try:
            transact(operations + [put(record, ConditionExpression='attribute_not_exists(pk)')],
                     labels + [None])
            return result
        except Retry:
            continue
    raise conflict('Stock changed while saving. Retry.')
