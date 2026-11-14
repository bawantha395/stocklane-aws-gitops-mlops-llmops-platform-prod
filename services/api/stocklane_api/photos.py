"""Vehicle photos (number plate, front, condition before fixing).

The phone shrinks each photo to a ~1280 px JPEG plus a small thumbnail and sends both here. They are kept
privately in the media bucket under workshop/photos/ and are read back through the API (not a public URL),
so only signed-in staff can see them.
"""
import base64
import binascii
import os
import re
import uuid

import boto3
from botocore.exceptions import ClientError

from .core import bad, missing

ID = re.compile(r'[0-9a-f]{32}')
FULL_MAX, THUMB_MAX = 900_000, 80_000
_s3 = None


def s3():
    global _s3
    if _s3 is None:
        _s3 = boto3.client('s3')
    return _s3


def bucket():
    name = os.environ.get('MEDIA_BUCKET')
    if not name:
        raise bad('Photo storage is not set up')
    return name


def jpeg(value, field, limit):
    try:
        raw = base64.b64decode(str(value or ''), validate=True)
    except (binascii.Error, ValueError):
        raise bad(field + ' is not a valid photo') from None
    if not raw.startswith(b'\xff\xd8\xff') or len(raw) > limit:
        raise bad(field + ' must be a JPEG under %d KB' % (limit // 1000))
    return raw


def save(body):
    full, thumb = jpeg(body.get('image'), 'The photo', FULL_MAX), jpeg(body.get('thumb'), 'The thumbnail', THUMB_MAX)
    pid = uuid.uuid4().hex
    for key, data in (('workshop/photos/%s.jpg' % pid, full), ('workshop/photos/%s-t.jpg' % pid, thumb)):
        s3().put_object(Bucket=bucket(), Key=key, Body=data, ContentType='image/jpeg', CacheControl='private, max-age=31536000')
    return {'id': pid}


def read(pid, size='thumb'):
    if not ID.fullmatch(pid):
        raise missing('Photo not found')
    key = 'workshop/photos/%s%s.jpg' % (pid, '-t' if size == 'thumb' else '')
    try:
        body = s3().get_object(Bucket=bucket(), Key=key)['Body'].read()
    except ClientError as error:
        if error.response['Error']['Code'] in ('NoSuchKey', '404'):
            raise missing('Photo not found') from None
        raise
    return {'data': base64.b64encode(body).decode()}


def one(value, field='Photo'):
    v = str(value or '').strip()
    if v and not ID.fullmatch(v):
        raise bad(field + ' is not valid')
    return v


def many(value, field='Photos', limit=6):
    if value in (None, ''):
        return []
    if not isinstance(value, list):
        raise bad(field + ' must be a list')
    out = []
    for item in value:
        pid = one(item, field)
        if pid and pid not in out:
            out.append(pid)
    if len(out) > limit:
        raise bad('Up to %d photos' % limit)
    return out
