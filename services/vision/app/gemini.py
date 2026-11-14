"""Free-tier Gemini as a backup when Bedrock cannot answer. Plain HTTPS, no extra package."""
import base64
import io
import json
import logging
import re
import time
import urllib.error
import urllib.request

from .bedrock import LIMITS, SYSTEM, BedrockUnavailable, user_text

URL = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
LIST_URL = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200'
_found = {'at': 0.0, 'models': []}
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


def discover(settings):
    """Ask Google which models this key can use, newest stable Flash first. Cached for an hour; names change over time."""
    if _found['models'] and time.time() - _found['at'] < 3600:
        return _found['models']
    request = urllib.request.Request(LIST_URL, headers={'x-goog-api-key': settings.gemini_api_key})
    with urllib.request.urlopen(request, timeout=6) as response:
        listing = json.load(response).get('models', [])
    def usable(m):
        name = m.get('name', '').removeprefix('models/')
        return ('generateContent' in m.get('supportedGenerationMethods', []) and 'flash' in name
                and not re.search(r'image|tts|live|audio|embed|robot|computer|thinking|exp|vision', name))
    def rank(name):
        version = [int(x) for x in re.findall(r'\d+', name.split('flash')[0])] or [0]
        return (0 if 'preview' in name or 'latest' in name else 1, version, 1 if 'lite' in name else 0)
    names = sorted({m['name'].removeprefix('models/') for m in listing if usable(m)}, key=rank, reverse=True)
    _found.update(at=time.time(), models=names)
    return names


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
    started = time.monotonic()
    budget = 24.0  # API Gateway allows 30 s in all; leave room for OCR and the reply

    def attempt(model):
        """One model, with whatever time is left. Raises HTTPError / timeouts for the caller to decide."""
        left = max(4.0, min(14.0, budget - (time.monotonic() - started)))
        try:
            return _call(settings, body, left, model)
        except urllib.error.HTTPError as error:
            if error.code != 400 or 'thinkingConfig' not in body['generationConfig']:
                raise
            log.warning('Gemini rejected the thinking setting; retrying without it')
            return _call(settings, dict(body, generationConfig=config), left, model)  # some models do not accept thinkingConfig

    def slow(error):
        return isinstance(error, (TimeoutError, OSError)) and not isinstance(error, urllib.error.HTTPError)

    trail = []  # "model: reason" for every model that failed, shown in the app's banner
    why = {404: 'not found', 429: 'free limit', 503: 'busy', 400: 'rejected', 401: 'key not accepted', 403: 'key not accepted', 500: 'Google error'}
    try:
        data, last, tried = None, None, []
        queue = list(models)
        discovered = False
        while data is None:
            if not queue:
                # Every configured name failed (not found / quota / slow): ask Google which models exist today.
                if discovered or time.monotonic() - started > budget - 4:
                    break
                discovered = True
                try:
                    queue = [m for m in discover(settings) if m not in tried][:4]
                except Exception:
                    break
                log.info('Trying discovered Gemini models %s', queue)
                continue
            model = queue.pop(0)
            tried.append(model)
            try:
                data = attempt(model)
                log.info('Gemini answered model=%s in %.1fs', model, time.monotonic() - started)
            except urllib.error.HTTPError as error:
                last = error
                trail.append(model + ': ' + why.get(error.code, 'error ' + str(error.code)))
                log.warning('Gemini model=%s failed status=%s', model, error.code)
                if error.code not in (404, 429, 503):
                    raise
            except Exception as error:
                if not slow(error):
                    raise
                last = error
                trail.append(model + ': too slow')
                log.warning('Gemini model=%s too slow or unreachable (%s)', model, type(error).__name__)
                if time.monotonic() - started > budget - 4:
                    break
        if data is None:
            raise last or TimeoutError()
        fields = json.loads(data['candidates'][0]['content']['parts'][0]['text'])
        if not isinstance(fields, dict):
            raise ValueError('Expected a label JSON object')
    except urllib.error.HTTPError as error:
        log.warning('Gemini backup failed status=%s', error.code)
        raise BedrockUnavailable('AI_BACKUP_UNAVAILABLE', 'AI suggestions are unavailable. Enter the item manually.',
                                 retryable=error.code in (429, 500, 503), provider_code=str(error.code), trail=trail) from None
    except (ValueError, KeyError, IndexError, TypeError) as error:
        log.warning('Gemini backup unusable reply type=%s', type(error).__name__)
        raise BedrockUnavailable('AI_INVALID_RESPONSE', 'The AI response could not be used. No product was created. Enter the details manually.', status=502) from None
    except Exception as error:
        log.warning('Gemini backup unreachable type=%s', type(error).__name__)
        raise BedrockUnavailable('AI_PROVIDER_TIMEOUT', 'The AI service could not be reached. Retry later or enter the item manually.', retryable=True, provider_code='AI_PROVIDER_TIMEOUT', trail=trail) from None
    return {k: v.strip()[:LIMITS[k]] for k, v in fields.items() if k in LIMITS and isinstance(v, str) and v.strip()}, 'gemini'
