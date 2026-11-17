"""What the shop owes its suppliers.

A delivery marked "on credit" owes its value (cost x quantity, from the delivery's own lines). Payments to the supplier and parts sent back
(at the price paid) lower it. Payments are kept in one running list per shop:

  SPAY/<at>#<id>     one payment to a supplier (amount, method, note, who, voided + why)

Nothing here is stored as a balance: it is worked out from the deliveries, returns and payments every time, so a corrected cost price on a
delivery is reflected at once. A payment is matched to the oldest bills first, which shows what is overdue (the bill's date plus the
supplier's credit days, as they were on the day of the delivery).
"""
import uuid
from datetime import timedelta
from decimal import Decimal

from . import suppliers as sup
from .core import bad, command, conflict, missing, now, num, public, put, query, update
from .workshop import MONEY, ZERO, clean, local_date, money, text, today

METHODS = ('CASH', 'BANK', 'CHEQUE', 'OTHER')


def _group(rows, kinds):
    """Movement rows of these kinds, joined into one entry per note (a note's lines share its number)."""
    docs = {}
    for m in rows:
        if m['kind'] not in kinds:
            continue
        d = docs.setdefault(m.get('doc_no') or m['id'], {'doc_no': m.get('doc_no'), 'id': m['id'], 'created_at': m['created_at'], 'reference': m.get('reference', ''),
                                                           'reason': m.get('reason', ''), 'terms': m.get('terms', 'PAID'), 'due_days': int(m.get('due_days') or 0),
                                                           'amount': ZERO, 'unknown': 0, 'lines': 0})
        d['lines'] += 1
        if m.get('unit_cost') is not None:
            d['amount'] += (m['unit_cost'] * m['quantity']).quantize(MONEY)
        else:
            d['unknown'] += 1
    return sorted(docs.values(), key=lambda d: d['created_at'])


def _books(supplier_id, moves, payments, on):
    mine = [m for m in moves if m.get('supplier_id') == supplier_id]
    bills = [b for b in _group(mine, ('RECEIPT',)) if b['terms'] == 'CREDIT']
    returns = _group(mine, ('SUPPLIER_RETURN',))
    paid = [p for p in payments if p['supplier_id'] == supplier_id]
    paid_total = sum((p['amount'] for p in paid if not p.get('voided')), ZERO)
    returned_total = sum((r['amount'] for r in returns), ZERO)
    left = paid_total + returned_total
    open_total = overdue = ZERO
    oldest = 0
    for b in bills:  # the oldest bills are the ones payments and returns settle first
        take = min(left, b['amount'])
        left -= take
        b['open'] = b['amount'] - take
        due = local_date(b['created_at']) + timedelta(days=b['due_days'])
        b['due'] = due.isoformat()
        b['overdue_days'] = (on - due).days if b['open'] > 0 and on > due else 0
        open_total += b['open']
        if b['overdue_days']:
            overdue += b['open']
            oldest = max(oldest, b['overdue_days'])
    balance = sum((b['amount'] for b in bills), ZERO) - paid_total - returned_total
    return {'balance': balance, 'open': open_total, 'overdue': overdue, 'oldest_overdue_days': oldest,
            'incomplete': sum(b['unknown'] for b in bills + returns), 'bills': list(reversed(bills)), 'returns': list(reversed(returns)),
            'payments': [public(p) for p in sorted(paid, key=lambda p: p['at'], reverse=True)]}


def books(supplier_id):
    s = sup.one(supplier_id)
    moves = [m for m in query('MOVE') if m.get('supplier_id') == s['id'] and m['kind'] in ('RECEIPT', 'SUPPLIER_RETURN')]
    payments = [p for p in query('SPAY') if p['supplier_id'] == s['id']]
    out = _books(s['id'], moves, payments, today())
    return {'supplier': {'id': s['id'], 'name': s['name'], 'credit_days': int(s.get('credit_days') or 0)}, **out}


def summary():
    """Every supplier that is owed something (or has credit), largest first."""
    moves = [m for m in query('MOVE') if m.get('supplier_id') and m['kind'] in ('RECEIPT', 'SUPPLIER_RETURN')]
    payments = query('SPAY')
    names, on, out = sup.names(), today(), []
    for sid in sorted({m['supplier_id'] for m in moves} | {p['supplier_id'] for p in payments}):
        if sid not in names:
            continue
        b = _books(sid, moves, payments, on)
        if b['balance'] != 0 or b['overdue']:
            out.append({'id': sid, 'name': names[sid], 'balance': b['balance'], 'overdue': b['overdue'], 'oldest_overdue_days': b['oldest_overdue_days'], 'bills': len(b['bills'])})
    total = sum((r['balance'] for r in out if r['balance'] > 0), ZERO)
    return {'total': total, 'overdue': sum((r['overdue'] for r in out), ZERO), 'suppliers': sorted(out, key=lambda r: -r['balance'])}


def pay(supplier_id, key, who, body):
    def build():
        b = body or {}
        s = sup.one(supplier_id)
        amount = money(b.get('amount'), 'Amount')
        if amount <= 0:
            raise bad('Enter the amount paid')
        method = str(b.get('method') or 'CASH').upper()
        if method not in METHODS:
            raise bad('Choose how it was paid: cash, bank, cheque or other')
        owed = books(s['id'])['balance']
        if amount > owed:
            raise bad('This supplier is owed LKR %s. Enter that or less.' % format(max(owed, ZERO), ',.2f'))
        at, pid = now(), uuid.uuid4().hex
        row = clean({'pk': 'SPAY', 'sk': at + '#' + pid, 'id': pid, 'supplier_id': s['id'], 'supplier': s['name'], 'amount': amount, 'method': method,
                     'note': text(b.get('note'), 'Note', 200, False), 'at': at, 'by': who})
        return [put(row, ConditionExpression='attribute_not_exists(pk)')], [None], public(row)
    return command(key, 'supplier-pay:' + supplier_id, who, body, build)


def void_payment(supplier_id, payment_id, key, who, body):
    """A payment entered by mistake is crossed out with a reason; it stays on the list."""
    def build():
        reason = text((body or {}).get('reason'), 'Reason', 200, True)
        row = next((p for p in query('SPAY') if p['id'] == payment_id and p['supplier_id'] == supplier_id), None)
        if not row:
            raise missing('Payment not found')
        if row.get('voided'):
            raise conflict('This payment is already crossed out')
        new = dict(row, voided=True, voided_reason=reason, voided_by=who, voided_at=now())
        return [put(new, ConditionExpression='attribute_not_exists(voided)')], [None], public(new)
    return command(key, 'supplier-pay-void:' + payment_id, who, body, build)
