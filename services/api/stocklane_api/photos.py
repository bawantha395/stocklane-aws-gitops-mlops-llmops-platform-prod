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


# ---------- the business logo: one small JPEG, replaced as a whole ----------
LOGO_MAX = 150_000


def jpeg_info(raw):
    """(width, height, components) read from the JPEG's frame header, so the PDF can embed it without any image library."""
    i = 2
    while i + 9 < len(raw):
        if raw[i] != 0xFF:
            i += 1
            continue
        marker = raw[i + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        length = int.from_bytes(raw[i + 2:i + 4], 'big')
        if marker in (0xC0, 0xC1, 0xC2):
            return int.from_bytes(raw[i + 7:i + 9], 'big'), int.from_bytes(raw[i + 5:i + 7], 'big'), raw[i + 9]
        i += 2 + length
    raise bad('The logo is not a valid JPEG')


def logo_check(value):
    raw = jpeg(value, 'The logo', LOGO_MAX)
    w, h, comps = jpeg_info(raw)
    if comps not in (1, 3) or not (32 <= w <= 1600 and 32 <= h <= 1600):
        raise bad('The logo must be a normal colour or grey picture between 32 and 1600 pixels')
    return raw, w, h, comps


def logo_save(raw, version):
    s3().put_object(Bucket=bucket(), Key='workshop/logo/%s.jpg' % version, Body=raw, ContentType='image/jpeg', CacheControl='private, max-age=31536000')


def logo_bytes(version):
    """The stored logo, or None when it cannot be read (a bill is never blocked by a logo problem)."""
    if not version or not re.fullmatch(r'[0-9a-f]{32}', str(version)):
        return None
    try:
        return s3().get_object(Bucket=bucket(), Key='workshop/logo/%s.jpg' % version)['Body'].read()
    except Exception:  # noqa: BLE001
        return None


def logo_drop(version):
    try:
        if version and re.fullmatch(r'[0-9a-f]{32}', str(version)):
            s3().delete_object(Bucket=bucket(), Key='workshop/logo/%s.jpg' % version)
    except Exception:  # noqa: BLE001
        pass
