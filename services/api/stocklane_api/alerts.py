"""The owner's cockpit: today at a glance, and leak alerts.

Alerts are not stored when they happen. Each one is worked out from the books (bills, payments, stock movements, cost edits) for the last 30
days, so they can never disagree with the reports. The only thing stored is "Seen": ALERTSEEN/<alert key> says who ticked it off and when.
An alert has a stable key (type#reference), so ticking it off once is enough.
"""
from datetime import timedelta
from decimal import Decimal

from .core import bad, command, get, now, put, query

TYPES = ('BELOW_COST', 'DISCOUNT', 'VOID', 'REFUND', 'COUNT', 'COST_EDIT', 'STOCK_RETURN')
DISCOUNT_PCT = Decimal('10')   # a bill discounted by more than this share of its value
WINDOW_DAYS = 30
MAX_SEEN = 50


def _seen():
    return {r['sk']: r for r in query('ALERTSEEN')}


def found(days=WINDOW_DAYS):
    from . import workshop
    from .workshop import line_total, local_date, profit_of, today, winv
    since = (today() - timedelta(days=days)).isoformat()
    out, costs = [], {}

    def add(kind, ref, at, who, title, detail, amount=None):
        out.append({'key': '%s#%s' % (kind, ref), 'type': kind, 'at': at, 'by': who or '', 'title': title, 'detail': detail, 'amount': amount})

    for i in winv():
        if i['status'] == 'VOID':
            if i.get('voided_at') and local_date(i['voided_at']).isoformat() >= since:
                add('VOID', i['id'], i['voided_at'], i.get('voided_by'), 'Bill voided: %s' % i['invoice_number'], '%s. %s' % (i.get('registration', ''), i.get('voided_reason', '')), i.get('original_total', i['total']))
            continue
        for p in i.get('payments') or []:
            if p.get('refund') and local_date(p['at']).isoformat() >= since:
                add('REFUND', '%s:%s' % (i['id'], p['id']), p['at'], p.get('by'), 'Money given back: %s' % i['invoice_number'], '%s. %s' % (i.get('registration', ''), (p.get('note') or '').replace('Refund: ', '', 1)), -p['amount'])
        if local_date(i['created_at']).isoformat() < since:
            continue
        pr = profit_of(i, costs)
        base = pr['parts_sales'] + pr['labour']
        if pr['discount'] > 0 and base > 0 and pr['discount'] * 100 / base > DISCOUNT_PCT:
            add('DISCOUNT', i['id'], i['created_at'], i.get('created_by'), 'Big discount: %s' % i['invoice_number'],
                '%s. %s%% off (LKR %s)' % (i.get('registration', ''), (pr['discount'] * 100 / base).quantize(Decimal('0.1')), format(pr['discount'], ',.2f')), pr['discount'])
        low = []
        for p in i.get('parts', []):
            qty = p['quantity'] - (p.get('returned') or 0)
            each = p.get('outside_cost') if p.get('outside') else p.get('cost_each')
            if qty > 0 and each is not None and line_total(dict(p, quantity=qty)) < each * qty:
                low.append(p.get('name') or 'Part')
        if low:
            add('BELOW_COST', i['id'], i['created_at'], i.get('created_by'), 'Sold below cost: %s' % i['invoice_number'], '%s. %s' % (i.get('registration', ''), ', '.join(low[:3])))
    for m in query('MOVE', gte=since):
        if m['kind'] in ('COUNT_IN', 'COUNT_OUT'):
            sign = '+' if m['kind'] == 'COUNT_IN' else '-'
            add('COUNT', m['id'], m['created_at'], m.get('actor'), 'Stock count changed: %s' % m.get('name', ''), '%s%s %s after a count' % (sign, m['quantity'], m.get('unit', '')))
        elif m['kind'] == 'SUPPLIER_RETURN':
            add('STOCK_RETURN', m['id'], m['created_at'], m.get('actor'), 'Sent back to supplier: %s' % m.get('name', ''), '%s %s' % (m['quantity'], m.get('unit', '')))
    for e in query('COSTEV', gte=since):
        add('COST_EDIT', e['sk'], e['at'], e.get('by'), 'Cost price changed: %s' % e.get('name', ''), 'from %s to %s' % (e.get('old') or 'not entered', e['new']))
    return sorted(out, key=lambda a: a['at'], reverse=True)


def listing():
    seen = _seen()
    rows = [dict(a, seen=a['key'] in seen, seen_by=(seen.get(a['key']) or {}).get('by', '')) for a in found()]
    return {'alerts': rows[:200], 'unseen': sum(1 for a in rows if not a['seen']), 'types': list(TYPES)}


def unseen():
    seen = _seen()
    return sum(1 for a in found() if a['key'] not in seen)


def mark_seen(key, who, body):
    def build():
        b = body or {}
        keys = b.get('keys')
        if b.get('all') is True:
            keys = [a['key'] for a in found()][:MAX_SEEN]
        if not isinstance(keys, list) or not keys or len(keys) > MAX_SEEN or not all(isinstance(k, str) and k.split('#')[0] in TYPES for k in keys):
            raise bad('Choose the alerts')
        at = now()
        ops = [put({'pk': 'ALERTSEEN', 'sk': k, 'by': who, 'at': at}) for k in keys]
        return ops, [None] * len(ops), {'seen': len(ops)}
    return command(key, 'alerts-seen', who, body, build)


def cockpit():
    """Today for the owner: money in, what it earned, what is owed, what needs a decision. Profit comes from the report itself."""
    from . import messages, orders, workshop
    day, month = workshop.today().isoformat(), workshop.today().replace(day=1).isoformat()
    now_r, mon_r = workshop.report(day, day), workshop.report(month, day)
    dash = workshop.dashboard()
    to_order = orders.to_order()
    return {
        'today': {'received': now_r['received'], 'billed': now_r['total'], 'profit': now_r['profit']['profit'], 'profit_unknown': now_r['profit']['unknown']},
        'month': {'received': mon_r['received'], 'billed': mon_r['total'], 'profit': mon_r['profit']['profit'], 'profit_unknown': mon_r['profit']['unknown']},
        'owing': dash['unpaid_total'], 'owing_count': dash['unpaid_count'], 'overdue_count': dash['overdue_count'],
        'to_order': to_order['open'], 'approvals': len(dash['delete_requests']),
        'messages': messages.count()['count'], 'alerts': unseen(),
    }
