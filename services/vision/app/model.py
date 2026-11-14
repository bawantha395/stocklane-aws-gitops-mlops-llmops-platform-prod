"""Load the approved encoder. The current model is named by config/model.json in the models bucket;
a new approval takes effect within five minutes, without redeploying the function."""
import hashlib
import io
import json
import logging
import tarfile
import time
from pathlib import Path

import boto3

from .encoder import Encoder

ALLOWED = {'encoder.onnx', 'model.json', 'metrics.json'}
_state = {'checked': 0.0, 'etag': None, 'encoder': None}


def _download(s3, bucket, pointer, folder):
    uri, expected = pointer['uri'], pointer['sha256']
    if not uri.startswith('s3://' + bucket + '/') or len(expected) != 64:
        raise ValueError('Model pointer must name this project\'s models bucket and a SHA256')
    data = s3.get_object(Bucket=bucket, Key=uri.split('/', 3)[3])['Body'].read(40 * 1024 * 1024 + 1)
    if len(data) > 40 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != expected:
        raise ValueError('Model bundle checksum mismatch')
    folder.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as tar:
        members = tar.getmembers()
        if any(not m.isfile() or m.name not in ALLOWED or m.size > 25 * 1024 * 1024 for m in members):
            raise ValueError('Unexpected model archive contents')
        for member in members:
            (folder / member.name).write_bytes(tar.extractfile(member).read())


def encoder(settings):
    """The current encoder, or None while no model has been released yet."""
    # While no model is loaded, look again after 15 s so a fresh release is picked up quickly; otherwise every 5 minutes.
    if time.monotonic() < _state['checked'] + (300 if _state['encoder'] is not None else 15):
        return _state['encoder']
    _state['checked'] = time.monotonic()
    s3 = boto3.client('s3')
    try:
        head = s3.head_object(Bucket=settings.model_bucket, Key='config/model.json')
    except s3.exceptions.ClientError as error:
        logging.getLogger(__name__).warning('Model pointer not readable code=%s bucket=%s',
                                            error.response.get('Error', {}).get('Code'), settings.model_bucket or '(unset)')
        return _state['encoder']
    if head['ETag'] != _state['etag'] or _state['encoder'] is None:
        pointer = json.loads(s3.get_object(Bucket=settings.model_bucket, Key='config/model.json')['Body'].read(65536))
        folder = Path(settings.model_dir) / pointer['sha256'][:16]
        if not (folder / 'model.json').exists():
            _download(s3, settings.model_bucket, pointer, folder)
        _state.update(encoder=Encoder(str(folder)), etag=head['ETag'])
    return _state['encoder']
