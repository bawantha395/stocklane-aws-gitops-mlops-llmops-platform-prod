"""Parts to order, and the orders sent to suppliers.

  WANT/<id>   one thing that must be bought: a stock part someone marked "order this", or a part a job needs (any name). OPEN, ORDERED, DONE or CANCELLED.
  ORD/<id>    one order to one supplier (PO-0001): its lines, the message that was sent, and what has come in so far.

The "to order" list is the open WANT rows plus every stock part at or below its reorder level that nobody has asked for yet. Making an order
turns the chosen lines into ORDERED, gives them a number and builds the message to send (WhatsApp or copy). A delivery from that supplier
closes the matching lines by itself (inventory calls on_receipt); an order can also be marked received or cancelled by hand.
"""
import uuid
from decimal import ROUND_CEILING, Decimal

from . import suppliers as sup
from .core import bad, command, conflict, get, missing, now, num, public, put, query, transact
from .inventory import active_products, load_product, next_doc_no
from .workshop import CHANGED, ZERO, business, clean, text

MAX_LINES = 40
LANGS = ('en', 'si')
OPEN_STATES = ('OPEN', 'ORDERED')


def qty(value, product=None, default=None):
    q = num(value if value not in (None, '') else (default if default is not None else 1), 'Quantity')
    if q <= 0 or q.as_tuple().exponent < -3:
        raise bad('Quantity must be positive, with at most 3 decimals')
    if product and product.get('unit') == 'UNIT' and q != q.to_integral_value():
        raise bad('%s is counted in whole units' % product['name'])
    return q


def suggest(p):
    """What to order for a part at or below its reorder level: enough to be back at twice that level."""
    want = (Decimal(p['reorder_level']) * 2 - p['quantity'])
    want = max(want, Decimal(1))
    return want.to_integral_value(rounding=ROUND_CEILING) if p['unit'] == 'UNIT' else want


# ---------- what is wanted ----------
def want_add(key, who, body):
    """Anyone who works on jobs can say a part is needed: a stock part (productId) or any part by name, optionally for a job."""
    def build():
        b = body or {}
        product = load_product(b['productId']) if b.get('productId') else None
        name = product['name'] if product else text(b.get('name'), 'Part name', 100, True)
        job = None
        if b.get('jobId'):
            job = get('WJOB', str(b['jobId']))
            if not job:
                raise missing('Repair job not found')
        if product and not job:
            for w in query('WANT'):
                if w.get('product_id') == product['id'] and w['status'] in OPEN_STATES and not w.get('job_id'):
                    raise conflict('%s is already on the to-order list' % product['name'])
        at, wid = now(), str(uuid.uuid4())
        row = clean({'pk': 'WANT', 'sk': wid, 'id': wid, 'product_id': product['id'] if product else None, 'name': name, 'part_no': (product or {}).get('part_number') or text(b.get('partNo'), 'Part number', 60, False) or None,
                     'unit': (product or {}).get('unit') or 'UNIT', 'quantity': qty(b.get('quantity'), product), 'supplier_id': (product or {}).get('supplier_id'),
                     'job_id': job['id'] if job else None, 'job_no': (job or {}).get('job_no'), 'registration': (job or {}).get('registration'),
                     'note': text(b.get('note'), 'Note', 200, False) or None, 'status': 'OPEN', 'revision': 0, 'by': who, 'created_at': at, 'updated_at': at})
        return [put(row, ConditionExpression='attribute_not_exists(pk)')], [None], public(row)
    return command(key, 'want-add', who, body, build)


def want_cancel(want_id, key, who, body):
    def build():
        w = get('WANT', want_id)
        if not w:
            raise missing('Not found')
        if w['status'] != 'OPEN':
            raise conflict('This one is already ordered or closed')
        new = dict(w, status='CANCELLED', revision=int(w['revision']) + 1, updated_at=now(), closed_by=who)
        return [put(new, ConditionExpression='revision = :r', ExpressionAttributeValues={':r': w['revision']})], [CHANGED], public(new)
    return command(key, 'want-cancel:' + want_id, who, body, build)


def to_order():
    names = sup.names()
    items, covered = [], set()
    for w in sorted(query('WANT'), key=lambda w: w['created_at']):
        if w['status'] not in OPEN_STATES:
            continue
        if w.get('product_id'):
            covered.add(w['product_id'])
        items.append({'key': 'want:' + w['id'], 'want_id': w['id'], 'product_id': w.get('product_id'), 'name': w['name'], 'part_no': w.get('part_no') or '', 'unit': w.get('unit', 'UNIT'),
                      'quantity': w['quantity'], 'supplier_id': w.get('supplier_id'), 'supplier': names.get(w.get('supplier_id'), ''), 'source': 'JOB' if w.get('job_id') else 'MARKED',
                      'job_no': w.get('job_no'), 'registration': w.get('registration'), 'note': w.get('note', ''), 'status': w['status'], 'order_no': w.get('order_no'), 'by': w.get('by')})
    for p in active_products():
        if p['id'] in covered or p['quantity'] > p['reorder_level'] or p['reorder_level'] <= 0:
            continue
        items.append({'key': 'low:' + p['id'], 'want_id': None, 'product_id': p['id'], 'name': p['name'], 'part_no': p.get('part_number') or '', 'unit': p['unit'], 'quantity': suggest(p),
                      'stock': p['quantity'], 'reorder_level': p['reorder_level'], 'supplier_id': p.get('supplier_id'), 'supplier': p.get('supplier') or '', 'source': 'LOW', 'status': 'OPEN'})
    return {'items': items, 'open': sum(1 for i in items if i['status'] == 'OPEN')}


# ---------- orders ----------
def amount(q, unit):
    n = Decimal(q)
    return format(n.quantize(Decimal(1)) if n == n.to_integral_value() else n.normalize(), 'f') + (' L' if unit == 'LITRE' else '')


def message(shop, supplier, order_no, lines, lang):
    rows = ['%d. %s%s x %s' % (i, (l['part_no'] + ' ' if l.get('part_no') else ''), l['name'], amount(l['quantity'], l.get('unit'))) for i, l in enumerate(lines, 1)]
    if lang == 'si':
        head = ['ආයුබෝවන් %s,' % supplier, '%s වෙතින් ඇණවුම %s:' % (shop, order_no), '']
        tail = ['', 'කරුණාකර ඇත්නම් සහ මිල දන්වන්න. ස්තූතියි.']
    else:
        head = ['Hello %s,' % supplier, 'Order %s from %s:' % (order_no, shop), '']
        tail = ['', 'Please confirm what you have and the price. Thank you.']
    return '\n'.join(head + rows + tail)


def make(key, who, body):
    """One order to one supplier from the chosen lines. Each line is a wantId (already on the list) or a productId (a low-stock part: it is put on the list
    and ordered in one step). The lines turn ORDERED and the order number and message are returned."""
    def build():
        b = body or {}
        s = sup.one(b.get('supplierId'))
        if not s.get('active', True):
            raise bad('%s is closed. Open it again in Suppliers or choose another.' % s['name'])
        shop_data = business()
        lang = b.get('lang') if b.get('lang') in LANGS and shop_data.get('sinhala') else 'en'  # Sinhala only when the owner switched it on
        picks = b.get('items')
        if not isinstance(picks, list) or not picks:
            raise bad('Choose what to order')
        if len(picks) > MAX_LINES:
            raise bad('One order holds up to %d lines' % MAX_LINES)
        order_no, counter = next_doc_no('ORDER')
        oid, at = str(uuid.uuid4()), now()
        ops, lines, seen = [counter], [], set()
        for pick in picks:
            if not isinstance(pick, dict):
                raise bad('Each line needs a part and a quantity')
            if pick.get('wantId'):
                w = get('WANT', str(pick['wantId']))
                if not w:
                    raise missing('A line is no longer on the list. Reload and try again.')
                if w['status'] != 'OPEN':
                    raise conflict('%s is already ordered or closed' % w['name'])
                product = get('PRODUCT', w['product_id']) if w.get('product_id') else None
            else:
                product = load_product(pick.get('productId'))
                w = {'pk': 'WANT', 'sk': str(uuid.uuid4()), 'product_id': product['id'], 'name': product['name'], 'part_no': product.get('part_number') or None,
                     'unit': product['unit'], 'status': 'OPEN', 'revision': -1, 'by': who, 'created_at': at}
                w['id'] = w['sk']
            if w['id'] in seen or (w.get('product_id') and w['product_id'] in seen):
                raise bad('%s is on two lines. Put them on one line' % w['name'])
            seen.add(w['id'])
            if w.get('product_id'):
                seen.add(w['product_id'])
            q = qty(pick.get('quantity'), product, default=w.get('quantity'))
            lines.append({'want_id': w['id'], 'product_id': w.get('product_id'), 'name': w['name'], 'part_no': w.get('part_no') or '', 'unit': w.get('unit', 'UNIT'), 'quantity': q, 'received': ZERO})
            new = clean(dict(w, quantity=q, status='ORDERED', order_id=oid, order_no=order_no, supplier_id=s['id'], revision=int(w['revision']) + 1, updated_at=at))
            ops.append(put(new, ConditionExpression='attribute_not_exists(pk)') if w['revision'] == -1 else
                       put(new, ConditionExpression='revision = :r', ExpressionAttributeValues={':r': w['revision']}))
        shop = shop_data['name']
        text_out = message(shop, s['name'], order_no, lines, lang)
        order = clean({'pk': 'ORD', 'sk': oid, 'id': oid, 'order_no': order_no, 'supplier_id': s['id'], 'supplier': s['name'], 'lines': lines, 'message': text_out, 'lang': lang,
                       'status': 'SENT', 'seen': [], 'revision': 0, 'by': who, 'created_at': at, 'updated_at': at})
        ops.insert(1, put(order, ConditionExpression='attribute_not_exists(pk)'))
        labels = [None, None] + [CHANGED if o['Put'].get('ConditionExpression', '').startswith('revision') else None for o in ops[2:]]
        return ops, labels, dict(public(order), contact={'phone': s.get('phone', ''), 'whatsapp': s.get('whatsapp', '')})
    return command(key, 'order-make', who, body, build)


def orders(status=''):
    rows = [public(o) for o in query('ORD', forward=False, limit=200) if not status or o['status'] == status]
    for o in rows:
        o['lines_count'], o['received_count'] = len(o['lines']), sum(1 for l in o['lines'] if l['received'] >= l['quantity'])
        o.pop('message', None)
        o['lines'] = [{k: v for k, v in l.items() if k in ('name', 'part_no', 'quantity', 'received', 'unit')} for l in o['lines']]
    return rows


def order(order_id):
    o = get('ORD', order_id)
    if not o:
        raise missing('Order not found')
    s = get('SUPP', o['supplier_id']) or {}
    return dict(public(o), contact={'phone': s.get('phone', ''), 'whatsapp': s.get('whatsapp', '')})


def _release(o, status, who, at):
    """Operations that close an order and settle its lines: received lines are DONE; a cancelled order puts what was not received back on the list."""
    ops = []
    for l in o['lines']:
        w = get('WANT', l['want_id'])
        if not w or w.get('order_id') != o['id']:
            continue
        if status == 'RECEIVED' or l['received'] >= l['quantity']:
            new = dict(w, status='DONE', revision=int(w['revision']) + 1, updated_at=at)
        else:
            new = dict(w, status='OPEN', revision=int(w['revision']) + 1, updated_at=at)
            new.pop('order_id', None), new.pop('order_no', None)
        ops.append(put(clean(new), ConditionExpression='revision = :r', ExpressionAttributeValues={':r': w['revision']}))
    return ops


def close(order_id, key, who, body):
    """action: 'received' (everything came) or 'cancel'."""
    def build():
        o, action = get('ORD', order_id), str((body or {}).get('action') or '')
        if not o:
            raise missing('Order not found')
        if action not in ('received', 'cancel'):
            raise bad('Choose received or cancel')
        if o['status'] != 'SENT':
            raise conflict('This order is already closed')
        at = now()
        status = 'RECEIVED' if action == 'received' else 'CANCELLED'
        lines = [dict(l, received=l['quantity']) for l in o['lines']] if status == 'RECEIVED' else o['lines']
        new = dict(o, lines=lines, status=status, revision=int(o['revision']) + 1, updated_at=at, closed_by=who)
        ops = [put(clean(new), ConditionExpression='revision = :r and #s = :sent', ExpressionAttributeNames={'#s': 'status'}, ExpressionAttributeValues={':r': o['revision'], ':sent': 'SENT'})]
        ops += _release(new, status, who, at)
        return ops, [CHANGED] + [CHANGED] * (len(ops) - 1), public(new)
    return command(key, 'order-close:' + order_id, who, body, build)


def on_receipt(supplier_id, received, token):
    """A delivery came from this supplier: count it against the open orders, oldest first. `token` (the note number) makes it count once."""
    left = {}
    for pid, q in received:
        left[pid] = left.get(pid, ZERO) + Decimal(q)
    for o in sorted((o for o in query('ORD') if o['supplier_id'] == supplier_id and o['status'] == 'SENT'), key=lambda o: o['created_at']):
        if token in (o.get('seen') or []) or not left:
            continue
        lines, touched = [dict(l) for l in o['lines']], False
        for l in lines:
            if l.get('product_id') in left and l['received'] < l['quantity']:
                take = min(left[l['product_id']], l['quantity'] - l['received'])
                l['received'] += take
                left[l['product_id']] -= take
                touched = True
                if left[l['product_id']] <= 0:
                    del left[l['product_id']]
        if not touched:
            continue
        at = now()
        done = all(l['received'] >= l['quantity'] for l in lines)
        new = dict(o, lines=lines, seen=(o.get('seen') or [])[-30:] + [token], status='RECEIVED' if done else 'SENT', revision=int(o['revision']) + 1, updated_at=at)
        ops = [put(clean(new), ConditionExpression='revision = :r', ExpressionAttributeValues={':r': o['revision']})]
        if done:
            ops += _release(new, 'RECEIVED', '', at)
        transact(ops, [None] * len(ops))
