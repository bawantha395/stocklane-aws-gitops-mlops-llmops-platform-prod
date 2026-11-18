"""Books check: the shop's own numbers tested against each other, the way an auditor would, read only.

 - every bill: the lines add up to the total, the payments add up to what is paid, the status says the same
 - every part: what is on the shelf is what all its stock movements add up to
 - the paperwork: no two bills with one number, no part sold with no cost on it, no delivery with no price
Nothing is changed. A tick means the numbers agree; a problem names the document so it can be looked at.
"""
import re
from decimal import Decimal

from .core import now, query
from .workshop import invoice_status, settled, totals

MAX_PROBLEMS = 100
SIGN = {'OPENING': 1, 'RECEIPT': 1, 'RETURN': 1, 'COUNT_IN': 1, 'ISSUE': -1, 'STOCK_OUT': -1, 'COUNT_OUT': -1, 'SUPPLIER_RETURN': -1, 'SHELF_MOVE': 0}


def run():
    problems, notes = [], []

    def bad(kind, ref, text):
        if len(problems) < MAX_PROBLEMS:
            problems.append({'kind': kind, 'ref': ref, 'text': text})

    bills = [settled(i) for i in query('WINV')]
    numbers, unknown_cost, billed_lines = {}, 0, 0
    for i in bills:
        ref = i.get('invoice_number') or i.get('id')
        numbers[ref] = numbers.get(ref, 0) + 1
        if i.get('status') == 'VOID':
            continue
        t = totals(i)
        if t['total'] != i.get('total'):
            bad('BILL_TOTAL', ref, 'The lines add up to %s but the bill says %s' % (format(t['total'], ',.2f'), format(i.get('total') or Decimal(0), ',.2f')))
        paid = sum((p['amount'] for p in i.get('payments') or []), Decimal(0))
        if paid != i.get('paid'):
            bad('BILL_PAID', ref, 'The payments add up to %s but the bill says %s paid' % (format(paid, ',.2f'), format(i.get('paid') or Decimal(0), ',.2f')))
        if invoice_status(i['total'], i['paid'], i.get('payments') or []) != i.get('status'):
            bad('BILL_STATUS', ref, 'The bill says %s but the money says %s' % (i.get('status'), invoice_status(i['total'], i['paid'], i.get('payments') or [])))
        for p in i.get('parts') or []:
            if p.get('product_id') and not p.get('outside'):
                billed_lines += 1
                if p.get('cost_each') is None:
                    unknown_cost += 1
    for ref, n in numbers.items():
        if n > 1:
            bad('BILL_NUMBER', ref, 'Used on %d bills' % n)
    run = sorted({int(m.group(1)) for ref in numbers for m in [re.fullmatch(r'[A-Z0-9]+-(\d{1,8})', str(ref))] if m})
    if run:  # the numbered run (INV-0001...) must have no holes; voided bills keep their number so they count
        missing = [n for n in range(run[0], run[-1] + 1) if n not in set(run)]
        if missing:
            bad('BILL_GAP', 'No. %s' % ', '.join(str(n) for n in missing[:10]), 'Missing from the bill numbers between %d and %d' % (run[0], run[-1]))
    older = sum(1 for ref in numbers if not re.fullmatch(r'[A-Z0-9]+-\d{1,8}', str(ref)))

    ledger, odd = {}, set()
    deliveries, no_price = 0, 0
    for m in query('MOVE'):
        pid = m.get('product_id')
        if m.get('kind') in SIGN:
            ledger[pid] = ledger.get(pid, Decimal(0)) + SIGN[m['kind']] * Decimal(str(m.get('quantity') or 0))
        else:
            odd.add(pid)  # a kind this check does not know: that part is left out rather than guessed
        if m.get('kind') == 'RECEIPT':
            deliveries += 1
            if m.get('unit_cost') is None:
                no_price += 1
    products = query('PRODUCT')
    for p in products:
        if p['id'] in ledger and p['id'] not in odd and ledger[p['id']] != p.get('quantity'):
            bad('STOCK', p.get('sku') or p['id'], '%s: the shelf says %s, the movements add up to %s' % (p.get('name', ''), p.get('quantity'), ledger[p['id']]))

    if unknown_cost:
        notes.append('%d part lines on bills have no cost price, so their profit is not counted. Add the cost price of the delivery (History).' % unknown_cost)
    if no_price:
        notes.append('%d of %d deliveries have no cost price.' % (no_price, deliveries))
    if older:
        notes.append('%d older bills were made before bill numbers ran 1, 2, 3. Their numbers carry the date and a code; they are unique.' % older)
    return {'checked_at': now(), 'bills': len(bills), 'products': len(products), 'ok': not problems, 'problems': problems, 'notes': notes}
