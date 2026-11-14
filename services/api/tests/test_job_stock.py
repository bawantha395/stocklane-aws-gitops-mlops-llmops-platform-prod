"""Parts taken from stock onto a workshop job: the job line and the stock move together, and never drift apart."""
from decimal import Decimal

from test_money_flow import ok  # noqa: F401  (same helpers)
from test_stock_count import product, stock


def new_job(api, reg='CAB-1234', role='MECHANIC'):
    return ok(api('POST', '/api/workshop/jobs', {'registration': reg, 'customer': 'Nimal Perera', 'phone': '0771234567', 'vehicle': 'Toyota Prius',
                                               'summary': 'Service', 'mechanic': 'Kamal'}, role=role))


def use(api, job, pid, qty, op='use', role='MECHANIC'):
    return api('POST', '/api/workshop/jobs/%s/stock' % job['id'], {'revision': job['revision'], 'productId': pid, 'quantity': qty, 'op': op}, role=role)


def test_use_and_take_back(api):
    p, job = product(api, 10), new_job(api)
    j = ok(use(api, job, p['id'], 3))
    line = j['parts'][0]
    assert line['product_id'] == p['id'] and line['quantity'] == 3 and line['unit_price'] == 1800 and j['parts_total'] == 5400
    assert j['stock']['balance'] == 7 and stock(api, p['id']) == 7
    j = ok(use(api, j, p['id'], 2))  # one line per part, quantities add up
    assert len(j['parts']) == 1 and j['parts'][0]['quantity'] == 5 and stock(api, p['id']) == 5
    j = ok(use(api, j, p['id'], 4, 'return'))
    assert j['parts'][0]['quantity'] == 1 and stock(api, p['id']) == 9
    j = ok(use(api, j, p['id'], 1, 'return'))
    assert j['parts'] == [] and stock(api, p['id']) == 10  # fully taken back: the line goes, stock is whole again
    kinds = [m['kind'] for m in ok(api('GET', '/api/inventory/movements', role='MECHANIC')) if m['kind'] in ('ISSUE', 'RETURN')]
    assert sorted(kinds) == ['ISSUE', 'ISSUE', 'RETURN', 'RETURN']


def test_negative_cases(api):
    p, job = product(api, 2), new_job(api)
    assert use(api, job, p['id'], 3)[0] == 409 and stock(api, p['id']) == 2  # not enough stock, nothing changed
    assert use(api, job, p['id'], 0)[0] == 400 and use(api, job, p['id'], -1)[0] == 400 and use(api, job, p['id'], 1.5)[0] == 400
    assert use(api, job, 'nope', 1)[0] == 404
    assert use(api, job, p['id'], 1, 'return')[0] == 409  # nothing to take back yet
    assert api('POST', '/api/workshop/jobs/%s/stock' % job['id'], {'revision': job['revision'], 'productId': p['id'], 'quantity': 1, 'op': 'zap'})[0] == 400
    j = ok(use(api, job, p['id'], 1))
    assert use(api, job, p['id'], 1)[0] == 200  # a stale revision does not matter: adding a part is additive
    assert use(api, j, p['id'], 5, 'return')[0] == 409  # cannot take back more than is on the job
    assert stock(api, p['id']) == 0


def test_stock_lines_are_protected_from_plain_edits(api):
    p, job = product(api, 5), new_job(api)
    j = ok(use(api, job, p['id'], 2))
    keep = dict(j['parts'][0])
    body = lambda parts: {'revision': j['revision'], 'parts': parts}
    for bad_parts in ([], [dict(keep, quantity=1)], [dict(keep, quantity=3)], [keep, dict(keep)], [keep, {'name': 'Fake', 'quantity': 1, 'unit_price': 5, 'product_id': 'other'}]):
        assert api('PATCH', '/api/workshop/jobs/' + j['id'], body(bad_parts))[0] == 400, bad_parts
    assert stock(api, p['id']) == 3
    # price and name may be changed, and free-text lines added next to it
    ok(api('PATCH', '/api/workshop/jobs/' + j['id'], body([dict(keep, unit_price=1500), {'name': 'Gasket', 'quantity': 1, 'unit_price': 200}])))
    got = ok(api('GET', '/api/workshop/jobs/' + j['id']))
    assert [x['unit_price'] for x in got['parts']] == [1500, 200] and got['parts'][0]['product_id'] == p['id']
    assert stock(api, p['id']) == 3


def test_cancel_and_delete_put_stock_back(api):
    p, a, b = product(api, 10), new_job(api, 'CAB-1111'), new_job(api, 'CAB-2222')
    ok(use(api, a, p['id'], 4)); ok(use(api, b, p['id'], 3))
    assert stock(api, p['id']) == 3
    ok(api('POST', '/api/workshop/jobs/%s/cancel' % a['id'], {'reason': 'Customer left'}))
    assert stock(api, p['id']) == 7
    assert all('product_id' not in x for x in ok(api('GET', '/api/workshop/jobs/' + a['id']))['parts'])  # plain text history now
    ok(api('POST', '/api/workshop/jobs/%s/archive' % b['id'], {'reason': 'Mistake'}))
    assert stock(api, p['id']) == 10
    # a restored job is ordinary: its text lines come back, stock stays as it is
    ok(api('POST', '/api/workshop/jobs/%s/restore' % b['id'], {}))
    assert stock(api, p['id']) == 10 and ok(api('GET', '/api/workshop/jobs/' + b['id']))['parts'][0]['quantity'] == 3


def test_invoiced_job_is_frozen_and_void_keeps_stock_out(api):
    p, job = product(api, 10), new_job(api)
    j = ok(use(api, job, p['id'], 2))
    inv = ok(api('POST', '/api/workshop/jobs/%s/invoice' % j['id'], {'revision': j['revision']}, role='MECHANIC'))
    assert stock(api, p['id']) == 8
    assert use(api, j, p['id'], 1)[0] == 409 and use(api, j, p['id'], 1, 'return')[0] == 409  # frozen once invoiced
    assert api('POST', '/api/workshop/jobs/%s/cancel' % j['id'], {'reason': 'x'})[0] == 409
    assert stock(api, p['id']) == 8


def test_archived_product_and_ledger_balance(api):
    p, job = product(api, 2), new_job(api)
    j = ok(use(api, job, p['id'], 2))  # shelf is now empty, so the part can be archived
    ok(api('POST', '/api/inventory/products/%s/archive' % p['id'], {'archived': True}))
    assert use(api, j, p['id'], 1)[0] == 409  # cannot use an archived part
    j = ok(use(api, j, p['id'], 2, 'return'))  # ...but what is on the job can still be taken back
    assert j['parts'] == []
    from stocklane_api.core import query
    total = sum((d['added'] - d['taken'] + d.get('adjusted', Decimal(0)) for d in query('DAY') if d['product_id'] == p['id']), Decimal(0))
    arch = ok(api('GET', '/api/inventory/products/archived'))
    assert total == next(x for x in arch if x['id'] == p['id'])['quantity'] == 2  # ledger and shelf agree


def test_mechanic_and_owner_can_both_use_stock(api):
    p, job = product(api, 5), new_job(api, role='OWNER')
    ok(use(api, job, p['id'], 1, role='OWNER'))
    assert stock(api, p['id']) == 4
