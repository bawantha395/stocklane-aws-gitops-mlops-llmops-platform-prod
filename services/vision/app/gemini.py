"""Free-tier Gemini as a backup when Bedrock cannot answer. Plain HTTPS, no extra package."""
import base64
import io
import json
import logging
import urllib.error
import urllib.request

from .bedrock import LIMITS, SYSTEM, BedrockUnavailable, user_text

URL = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
SCHEMA = {'type': 'OBJECT', 'properties': {k: {'type': 'STRING'} for k in LIMITS}}

def _small(image):
    """Half the pixels, a fraction of the upload time; labels stay readable at 1024 px."""
    try:
        from PIL import Image
        picture = Image.open(io.BytesIO(image)).convert('RGB')
        picture.thumbnail((1024, 1024))
        out = io.BytesIO()
        picture.save(out, 'JPEG', quality=85)
        return out.getvalue()
    except Exception:
        return image


def _call(settings, body, timeout, model=None):
    request = urllib.request.Request(URL.format(model=model or settings.gemini_model), data=json.dumps(body).encode(), method='POST',
                                     headers={'Content-Type': 'application/json', 'x-goog-api-key': settings.gemini_api_key})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def propose(settings, image, context=None):
    log = logging.getLogger(__name__)
    config = {'temperature': 0, 'maxOutputTokens': 2048, 'responseMimeType': 'application/json', 'responseSchema': SCHEMA}
    body = {'contents': [{'parts': [{'inline_data': {'mime_type': 'image/jpeg', 'data': base64.b64encode(_small(image)).decode()}},
                                    {'text': SYSTEM + ' ' + user_text(context)}]}],
            # Reading a label needs no long reasoning; "minimal" keeps the answer in a few seconds.
            'generationConfig': dict(config, thinkingConfig={'thinkingLevel': 'minimal'})}
    # Each model has its own free quota. GEMINI_MODEL may list several, separated by commas: the next one is tried when
    # a model is out of quota (429), unknown (404) or busy (503). A slow model is not retried, to stay inside the 30 s API limit.
    models = [m.strip() for m in settings.gemini_model.split(',') if m.strip()]
    try:
        data, last = None, None
        for model in models:
            try:
                try:
                    data = _call(settings, body, 18, model)
                except urllib.error.HTTPError as error:
                    if error.code != 400 or 'thinkingConfig' not in body['generationConfig']:
                        raise
                    log.warning('Gemini rejected the thinking setting; retrying without it')
                    plain = dict(body, generationConfig=config)  # an older or different model may not accept thinkingConfig
                    data = _call(settings, plain, 18, model)
                log.info('Gemini answered model=%s', model)
                break
            except urllib.error.HTTPError as error:
                last = error
                log.warning('Gemini model=%s failed status=%s', model, error.code)
                if error.code not in (404, 429, 503):
                    raise
        if data is None:
            raise last
        fields = json.loads(data['candidates'][0]['content']['parts'][0]['text'])
        if not isinstance(fields, dict):
            raise ValueError('Expected a label JSON object')
    except urllib.error.HTTPError as error:
        log.warning('Gemini backup failed status=%s', error.code)
        raise BedrockUnavailable('AI_BACKUP_UNAVAILABLE', 'AI suggestions are unavailable. Enter the item manually.',
                                 retryable=error.code in (429, 500, 503), provider_code=str(error.code)) from None
    except (ValueError, KeyError, IndexError, TypeError) as error:
        log.warning('Gemini backup unusable reply type=%s', type(error).__name__)
        raise BedrockUnavailable('AI_INVALID_RESPONSE', 'The AI response could not be used. No product was created. Enter the details manually.', status=502) from None
    except Exception as error:
        log.warning('Gemini backup unreachable type=%s', type(error).__name__)
        raise BedrockUnavailable('AI_PROVIDER_TIMEOUT', 'The AI service could not be reached. Retry later or enter the item manually.', retryable=True, provider_code='AI_PROVIDER_TIMEOUT') from None
    return {k: v.strip()[:LIMITS[k]] for k, v in fields.items() if k in LIMITS and isinstance(v, str) and v.strip()}, 'gemini'
