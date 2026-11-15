"""Random walks through the whole job / bill / return / refund / void life, checking after every step that the books still add up:
stock on the shelf = what we started with - what open jobs hold - what billed jobs still hold (billed minus returned), and the money on every bill agrees with its payments."""
import random

import pytest

from test_job_stock import new_job, use
from test_money_flow import BIZ, ok
from test_stock_count import product, stock

START = 40


def held(api, job_ids):
    """Units of stock that jobs and bills still hold."""
    total = 0
    for jid in job_ids:
        code, j = api('GET', '/api/workshop/jobs/%s' % jid)
        assert code == 200
        if j['status'] == 'OPEN':
            total += sum(p['quantity'] for p in j['parts'] if p.get('product_id'))
        elif j['status'] == 'INVOICED':
            code, inv = api('GET', '/api/workshop/invoices/%s' % j['invoice_id'])
            assert code == 200
            total += sum(p['quantity'] - (p.get('returned') or 0) for p in inv['parts'] if p.get('product_id'))
    return total


def books_ok(api, pid, job_ids, invoice_ids, note):
    assert stock(api, pid) == START - held(api, job_ids), 'stock drifted after ' + note
    for iid in invoice_ids:
        code, inv = api('GET', '/api/workshop/invoices/%s' % iid)
        assert code == 200
        assert inv['paid'] == sum(p['amount'] for p in inv['payments']), 'paid != payments after ' + note
        assert inv['paid'] >= 0 and inv['total'] >= 0, 'negative money after ' + note
        if inv['status'] != 'VOID':
            want = 'PAID' if inv['paid'] >= inv['total'] else 'PARTIAL' if inv['paid'] > 0 else ('REFUNDED' if any(p.get('refund') for p in inv['payments']) else 'UNPAID')
            assert inv['status'] == want, 'bill status %s should be %s after %s' % (inv['status'], want, note)


@pytest.mark.parametrize('seed', range(12))
def test_books_always_balance(api, seed):
    rnd = random.Random(seed)
    ok(api('PUT', '/api/workshop/settings', BIZ))
    p = product(api, START)
    pid = p['id']
    jobs, invoices = [], {}          # job id -> invoice id once billed
    n = 0
    for step in range(60):
        n += 1
        action = rnd.choice(['new', 'use', 'use', 'take_back', 'invoice', 'pay', 'return', 'refund', 'void', 'cancel', 'archive', 'restore'])
        note = 'step %d (%s), seed %d' % (step, action, seed)
        if action == 'new' or not jobs:
            jobs.append(new_job(api, 'CAB-%04d' % (1000 + len(jobs)))['id'])
        jid = rnd.choice(jobs)
        code, j = api('GET', '/api/workshop/jobs/%s' % jid)
        assert code == 200
        iid = invoices.get(jid)
        code = 200
        if action in ('use', 'take_back') and j['status'] == 'OPEN':
            code = use(api, j, pid, rnd.randint(1, 4), 'use' if action == 'use' else 'return')[0]
        elif action == 'invoice' and j['status'] == 'OPEN' and j['parts']:
            code, inv = api('POST', '/api/workshop/jobs/%s/invoice' % jid, {'revision': j['revision']}, role='MECHANIC')
            if code == 200:
                invoices[jid] = inv['id']
        elif action == 'pay' and iid:
            code, inv = api('GET', '/api/workshop/invoices/%s' % iid)
            owe = inv['total'] - inv['paid']
            if inv['status'] != 'VOID' and owe > 0:
                code = api('POST', '/api/workshop/invoices/%s/payments' % iid, {'amount': rnd.choice([owe, max(1, owe // 2)]), 'method': 'CASH'}, role='MECHANIC')[0]
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
            code = api('POST', '/api/workshop/invoices/%s/void' % iid, {})[0]
        elif action == 'cancel' and j['status'] == 'OPEN':
            code = api('POST', '/api/workshop/jobs/%s/cancel' % jid, {'revision': j['revision']})[0]
        elif action == 'archive' and j['status'] == 'OPEN':
            code = api('POST', '/api/workshop/jobs/%s/archive' % jid, {'revision': j['revision'], 'reason': 'Test'})[0]
        elif action == 'restore' and j['status'] == 'ARCHIVED':
            code = api('POST', '/api/workshop/jobs/%s/restore' % jid, {'revision': j['revision']})[0]
        assert code < 500, 'server error (%s) at %s' % (code, note)
        books_ok(api, pid, jobs, list(invoices.values()), note)
