"""Supplier warranty claims: a part that failed and the shop wants the supplier to take it back, replace it or give credit.

  CLAIM/<id>   {claim_no, product_id, name, sku, supplier_id, supplier, quantity, reason, ref, status, credit, timeline[], revision, created_*, updated_*}

A claim only follows the case. Sending the part back to the supplier is still done with "Send back to supplier" (it moves the stock and makes
the return note); the claim says why, who has it and how it ended. Status goes OPEN -> SENT (with the supplier) -> CREDITED, REPLACED or REJECTED.
A claim that ended stays as it was. Every change adds a line to the timeline.
"""
import uuid
from decimal import Decimal

from .core import bad, command, conflict, get, missing, now, put, query
from .workshop import CHANGED, ZERO, clean, money, quantity, text

STATUSES = ('OPEN', 'SENT', 'CREDITED', 'REPLACED', 'REJECTED')
ENDED = ('CREDITED', 'REPLACED', 'REJECTED')
LABEL = {'OPEN': 'Open', 'SENT': 'With the supplier', 'CREDITED': 'Credit received', 'REPLACED': 'Replaced', 'REJECTED': 'Rejected'}


def one(claim_id):
    c = get('CLAIM', str(claim_id or ''))
    if not c:
        raise missing('Claim not found')
    return c


def listing(status='', supplier_id=''):
    rows = sorted(query('CLAIM'), key=lambda c: c['created_at'], reverse=True)
    if status == 'ACTIVE':
        rows = [c for c in rows if c['status'] not in ENDED]
    elif status in STATUSES:
        rows = [c for c in rows if c['status'] == status]
    if supplier_id:
        rows = [c for c in rows if c.get('supplier_id') == supplier_id]
    return {'claims': [{k: v for k, v in c.items() if k not in ('pk', 'sk')} for c in rows[:300]],
            'open': sum(1 for c in query('CLAIM') if c['status'] not in ENDED)}


def get_claim(claim_id):
    c = one(claim_id)
    return {k: v for k, v in c.items() if k not in ('pk', 'sk')}


def create(key, who, body):
    def build():
        from . import inventory, suppliers
        b = body or {}
        product = inventory.load_product(b.get('productId'))
        qty = quantity(b.get('quantity', 1))
        if product['unit'] == 'UNIT' and qty != qty.to_integral_value():
            raise bad('Sealed units need a whole number')
        reason = text(b.get('reason'), 'What is wrong with the part', 300, True)
        sid, sname = suppliers.resolve(b.get('supplierId') or product.get('supplier_id'), b.get('supplier') or product.get('supplier'))
        if not sname:
            raise bad('Choose the supplier this part came from')
        at, claim_id = now(), str(uuid.uuid4())
        n = len(query('CLAIM')) + 1
        c = clean({'pk': 'CLAIM', 'sk': claim_id, 'id': claim_id, 'claim_no': 'WC-%04d' % n, 'product_id': product['id'], 'name': product['name'], 'sku': product['sku'],
                   'part_no': product.get('part_number') or '', 'supplier_id': sid or '', 'supplier': sname, 'quantity': qty,
                   'reason': reason, 'ref': text(b.get('ref'), 'Bill, job or delivery number', 60), 'status': 'OPEN', 'credit': ZERO, 'revision': 0,
                   'timeline': [{'at': at, 'by': who, 'status': 'OPEN', 'note': reason}], 'created_by': who, 'created_at': at, 'updated_at': at})
        return [put(c)], [None], {k: v for k, v in c.items() if k not in ('pk', 'sk')}
    return command(key, 'claim-create', who, body, build)


def set_status(claim_id, key, who, body):
    def build():
        current, b = one(claim_id), body or {}
        status = str(b.get('status') or '').upper()
        if status not in STATUSES or status == 'OPEN':
            raise bad('Choose what happened to the claim')
        if current['status'] in ENDED:
            raise conflict('This claim has ended. It stays as it is.')
        if int(b.get('revision', -1)) != int(current['revision']):
            raise conflict(CHANGED)
        if status == 'SENT' and current['status'] != 'OPEN':
            raise conflict('This claim is already with the supplier')
        credit = ZERO
        if status == 'CREDITED':
            credit = money(b.get('credit'), 'Credit amount')
            if credit <= 0:
                raise bad('Type the credit the supplier gave')
        note = text(b.get('note'), 'Note', 300, status == 'REJECTED')
        at = now()
        new = clean(dict(current, status=status, credit=credit if status == 'CREDITED' else current.get('credit', ZERO), revision=int(current['revision']) + 1, updated_at=at,
                         timeline=list(current['timeline']) + [{'at': at, 'by': who, 'status': status, 'note': note, **({'credit': credit} if status == 'CREDITED' else {})}]))
        return [put(new, ConditionExpression='revision = :r', ExpressionAttributeValues={':r': current['revision']})], [CHANGED], {k: v for k, v in new.items() if k not in ('pk', 'sk')}
    return command(key, 'claim-status:' + claim_id, who, body, build)
