"""The same random walk, but with two parts on the shelf, line discounts, labour, a bill discount, 15% tax and estimates turned into jobs.
Checks that stock for BOTH parts balances and that every bill's money is internally consistent."""
import random

import pytest

from test_job_stock import new_job, use
from test_money_flow import BIZ, ok

START = 30


def make_part(api, n):
    return ok(api('POST', '/api/inventory/products', {'partNumber': 'PN-%d' % n, 'sku': 'SK-%d' % n, 'name': 'Part %d' % n, 'category': 'Filters', 'brand': 'Toyota', 'unit': 'UNIT',
                                                      'sellingPrice': 1000 + 250 * n, 'reorderLevel': 3, 'openingQuantity': START, 'location': 'A%d' % n}))


def qty_of(api, pid):
    return next(p for p in ok(api('GET', '/api/inventory/products', role='MECHANIC')) if p['id'] == pid)['quantity']


def check(api, pids, job_ids, invoice_ids, note):
    held = {pid: 0 for pid in pids}
    for jid in job_ids:
        code, j = api('GET', '/api/workshop/jobs/%s' % jid)
        assert code == 200, note
        if j['status'] == 'OPEN':
            for p in j['parts']:
                if p.get('product_id'):
                    held[p['product_id']] += p['quantity']
        elif j['status'] == 'INVOICED':
            code, inv = api('GET', '/api/workshop/invoices/%s' % j['invoice_id'])
            for p in inv['parts']:
                if p.get('product_id'):
                    held[p['product_id']] += p['quantity'] - (p.get('returned') or 0)
    for pid in pids:
        assert qty_of(api, pid) == START - held[pid], 'stock of %s drifted after %s' % (pid, note)
    for iid in invoice_ids:
        code, inv = api('GET', '/api/workshop/invoices/%s' % iid)
        assert code == 200
        assert round(inv['paid'], 2) == round(sum(p['amount'] for p in inv['payments']), 2), 'paid != payments after ' + note
        assert round(inv['subtotal'], 2) == round(inv['parts_total'] + inv['labour_total'] - inv['discount'], 2), 'subtotal after ' + note
        before = inv.get('original_total', inv['total'])
        assert round(before, 2) == round(inv['subtotal'] + inv['tax'], 2), 'total != subtotal + tax after ' + note
        assert round(before - inv.get('credit_total', 0), 2) == round(inv['total'], 2), 'credit does not add up after ' + note
        assert inv['total'] >= 0 and inv['paid'] >= 0, 'negative money after ' + note
        if inv['status'] != 'VOID':
            assert inv['paid'] <= inv['total'], 'overpaid after ' + note


@pytest.mark.parametrize('seed', range(8))
def test_money_and_two_parts_balance(api, seed):
    rnd = random.Random(1000 + seed)
    ok(api('PUT', '/api/workshop/settings', {**BIZ, 'tax_rate': 15}))
    pids = [make_part(api, 1)['id'], make_part(api, 2)['id']]
    jobs, invoices = [], {}
    for step in range(60):
        action = rnd.choice(['new', 'use', 'use', 'take_back', 'edit', 'edit', 'quote', 'invoice', 'pay', 'return', 'refund', 'void', 'cancel'])
        note = 'step %d (%s), seed %d' % (step, action, seed)
        if action == 'new' or not jobs:
            jobs.append(new_job(api, 'CAB-%04d' % (2000 + len(jobs)))['id'])
        jid = rnd.choice(jobs)
        code, j = api('GET', '/api/workshop/jobs/%s' % jid)
        iid, code = invoices.get(jid), 200
        pid = rnd.choice(pids)
        if action in ('use', 'take_back') and j['status'] == 'OPEN':
            code = use(api, j, pid, rnd.randint(1, 4), 'use' if action == 'use' else 'return')[0]
        elif action == 'edit' and j['status'] == 'OPEN':
            keep = [{k: p[k] for k in ('name', 'quantity', 'unit_price', 'product_id') if k in p} | ({'discount_pct': p['discount_pct']} if p.get('discount_pct') else {}) for p in j['parts'] if p.get('product_id')]
            free = [{'name': 'Gasket %d' % i, 'quantity': rnd.randint(1, 3), 'unit_price': rnd.choice([250, 333.33, 1999.99]), 'discount_pct': rnd.choice([0, 5, 12.5])} for i in range(rnd.randint(0, 2))]
            labour = [{'description': 'Labour', 'amount': rnd.choice([0, 500, 1234.56])}]
            code = api('PATCH', '/api/workshop/jobs/%s' % jid, {'revision': j['revision'], 'parts': keep + free, 'labour': labour, 'discount': rnd.choice([0, 0, 100])}, role='OWNER')[0]
        elif action == 'quote':
            code, q = api('POST', '/api/workshop/quotes', {'registration': 'CAB-%04d' % (3000 + step), 'customer': 'Nimal', 'kind': rnd.choice(['ESTIMATE', 'QUOTATION']),
                                                          'parts': [{'name': 'Door', 'quantity': 1, 'unit_price': 5000}], 'labour': [{'description': 'Paint', 'amount': 2500, 'section': 'Repaint'}]})
            if code == 200:
                q = ok(api('POST', '/api/workshop/quotes/%s/status' % q['id'], {'revision': q['revision'], 'status': 'APPROVED'}))
                code, done = api('POST', '/api/workshop/quotes/%s/convert' % q['id'], {'revision': q['revision']})
                if code == 200:
                    jobs.append(done['job_id'])
        elif action == 'invoice' and j['status'] == 'OPEN' and (j['parts'] or j['labour']):
            code, inv = api('POST', '/api/workshop/jobs/%s/invoice' % jid, {'revision': j['revision']}, role='MECHANIC')
            if code == 200:
                invoices[jid] = inv['id']
        elif action == 'pay' and iid:
            code, inv = api('GET', '/api/workshop/invoices/%s' % iid)
            owe = inv['total'] - inv['paid']
            if inv['status'] != 'VOID' and owe > 0:
                code = api('POST', '/api/workshop/invoices/%s/payments' % iid, {'amount': rnd.choice([owe, round(owe / 3, 2) or owe]), 'method': 'CASH'}, role='MECHANIC')[0]
        elif action == 'return' and iid:
            code, inv = api('GET', '/api/workshop/invoices/%s' % iid)
            lines = [{'index': i, 'quantity': 1} for i, x in enumerate(inv['parts']) if x['quantity'] - (x.get('returned') or 0) >= 1][:1]
            if inv['status'] != 'VOID' and lines:
                code = api('POST', '/api/workshop/invoices/%s/return' % iid, {'lines': lines, 'reason': 'Wrong part', 'refundMethod': 'CASH'})[0]
        elif action == 'refund' and iid:
            code, inv = api('GET', '/api/workshop/invoices/%s' % iid)
            if inv['status'] != 'VOID' and inv['paid'] > 0:
                code = api('POST', '/api/workshop/invoices/%s/refund' % iid, {'amount': rnd.choice([inv['paid'], 1]), 'method': 'CASH', 'reason': 'Customer cancelled'})[0]
        elif action == 'void' and iid:
            code = api('POST', '/api/workshop/invoices/%s/void' % iid, {'reason': 'Wrong car'})[0]
        elif action == 'cancel' and j['status'] == 'OPEN':
            code = api('POST', '/api/workshop/jobs/%s/cancel' % jid, {'revision': j['revision']})[0]
        assert code < 500, 'server error (%s) at %s' % (code, note)
        check(api, pids, jobs, list(invoices.values()), note)
