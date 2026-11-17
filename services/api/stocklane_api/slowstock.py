"""Slow stock: parts on the shelf that have not been sold or used for a long time. Money sitting still.

A part counts when it has stock, was put on the shelf more than `days` ago, and nothing has gone out (on a job or over the counter) in the last
`days`. Stock value is quantity x the last known cost, so it is owner-only; a part whose cost nobody knows is listed with no value, never guessed.
"""
from datetime import date, timedelta
from decimal import Decimal

from .core import bad, query
from .inventory import OUT_KINDS, active_products

DEFAULT_DAYS = 90
ZERO = Decimal(0)


def parse_days(value):
    try:
        days = int(value) if value not in (None, '') else DEFAULT_DAYS
    except (TypeError, ValueError):
        raise bad('Days must be a number')
    if not 30 <= days <= 730:
        raise bad('Pick between 30 and 730 days')
    return days


def slow(days=DEFAULT_DAYS, category=''):
    from .workshop import local_date, today
    on = today()
    last_out = {}
    for m in query('MOVE'):
        if m['kind'] in OUT_KINDS:
            d = local_date(m['created_at'])
            if m['product_id'] not in last_out or d > last_out[m['product_id']]:
                last_out[m['product_id']] = d
    rows, by_cat = [], {}
    for p in active_products():
        if p['quantity'] <= 0 or (category and p.get('category') != category):
            continue
        stocked = local_date(p['created_at']) if p.get('created_at') else on
        sold = last_out.get(p['id'])
        since = max(stocked, sold) if sold else stocked
        gone = (on - since).days
        if gone < days:
            continue
        cost = p.get('last_cost')
        value = (Decimal(str(cost)) * Decimal(str(p['quantity']))).quantize(Decimal('0.01')) if cost is not None else None
        rows.append({'id': p['id'], 'name': p['name'], 'sku': p.get('sku', ''), 'category': p.get('category') or '', 'quantity': p['quantity'], 'unit': p.get('unit', ''),
                     'location': p.get('location', ''), 'last_sold': sold.isoformat() if sold else None, 'days': gone, 'value': value})
        c = by_cat.setdefault(p.get('category') or '', {'category': p.get('category') or '', 'items': 0, 'value': ZERO})
        c['items'] += 1
        c['value'] += value or ZERO
    rows.sort(key=lambda r: (-(r['value'] or ZERO), -r['days']))
    cats = sorted(by_cat.values(), key=lambda c: -c['value'])
    return {'days': days, 'items': rows[:300], 'count': len(rows), 'value': sum((r['value'] or ZERO for r in rows), ZERO),
            'unknown_cost': sum(1 for r in rows if r['value'] is None), 'categories': cats}
