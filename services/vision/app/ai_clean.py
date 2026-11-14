"""Checks what the AI returned before it reaches the form: short, plausible values only, never its own commentary."""
import re

CAPS = {'name': 80, 'brand': 40, 'partNumber': 30, 'category': 40, 'grade': 40, 'capacity': 24}
TALK = re.compile(r"\b(not|omit|omitted|unknown|unclear|n/?a|none|visible|printed|similar|identifier|if needed|cannot|can't|unable|illegible|unreadable|no part)\b", re.I)
squash = lambda s: re.sub(r'[^A-Z0-9]', '', s.upper())


def clean(fields, ocr_text=''):
    out = {}
    seen = squash(ocr_text or '')
    for key, raw in (fields or {}).items():
        if not isinstance(raw, str):
            continue
        value = re.sub(r'\s+', ' ', raw).strip(' .;:,-')
        if not value:
            continue
        if key == 'unit':
            low = value.lower()
            if low.startswith(('litre', 'liter', 'bulk', 'loose', 'measured')) or low in ('l', 'ltr'):
                out['unit'] = 'litre'
            elif low:
                out['unit'] = 'piece'
            continue
        if key not in CAPS or len(value) > CAPS[key] or TALK.search(value):
            continue
        if key == 'partNumber':
            # a part number is a short code that really appears in the label text; anything else is a guess
            if len(value.split()) > 3 or not re.search(r'\d', value) or len(squash(value)) < 3 or squash(value) not in seen:
                continue
        out[key] = value
    return out
