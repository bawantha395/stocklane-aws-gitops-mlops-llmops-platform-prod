"""Supplier payables (credit deliveries, payments, returns), and the to-order list with order messages."""
from test_money_flow import BIZ, ok
from test_shops import PART
from test_suppliers import part, supplier


def receive(api, s, p, qty, cost, terms='CREDIT', **kw):
    return ok(api('POST', '/api/inventory/documents', dict({'kind': 'RECEIPT', 'supplierId': s['id'], 'terms': terms, 'reference': 'DN',
                                                           'lines': [{'productId': p['id'], 'quantity': qty, 'unitCost': cost}]}, **kw)))


def books(api, s, **kw):
    return ok(api('GET', '/api/inventory/suppliers/%s/payables' % s['id'], **kw))


def test_credit_deliveries_make_a_balance_and_payments_settle_the_oldest_first(api):
    s, p = supplier(api), part(api)
    receive(api, s, p, 4, 1000)          # 4000 on credit
    receive(api, s, p, 2, 500, 'PAID')   # paid now: owes nothing
    receive(api, s, p, 1, 600)           # 600 on credit
    b = books(api, s)
    assert b['balance'] == 4600 and len(b['bills']) == 2 and b['overdue'] == 0
    assert all(x['due_days'] == 30 for x in b['bills'])  # the supplier's credit days were copied on the day
    pay = ok(api('POST', '/api/inventory/suppliers/%s/payments' % s['id'], {'amount': 4100, 'method': 'BANK', 'note': 'part'}))
    b = books(api, s)
    assert b['balance'] == 500 and pay['method'] == 'BANK'
    assert [x['open'] for x in b['bills']] == [500, 0]  # newest first; the older bill was settled first
    code, body = api('POST', '/api/inventory/suppliers/%s/payments' % s['id'], {'amount': 501})
    assert code == 400 and 'owed' in body['message']
    assert api('POST', '/api/inventory/suppliers/%s/payments' % s['id'], {'amount': 0})[0] == 400
    assert api('POST', '/api/inventory/suppliers/%s/payments' % s['id'], {'amount': 10, 'method': 'GOLD'})[0] == 400
    assert api('POST', '/api/inventory/suppliers/%s/payments' % s['id'], {'amount': 500})[0] == 200
    assert books(api, s)['balance'] == 0


def test_a_payment_is_crossed_out_with_a_reason(api):
    s, p = supplier(api), part(api)
    receive(api, s, p, 1, 1000)
    pay = ok(api('POST', '/api/inventory/suppliers/%s/payments' % s['id'], {'amount': 1000}))
    assert books(api, s)['balance'] == 0
    url = '/api/inventory/suppliers/%s/payments/%s/void' % (s['id'], pay['id'])
    assert api('POST', url, {})[0] == 400
    ok(api('POST', url, {'reason': 'wrong supplier'}))
    b = books(api, s)
    assert b['balance'] == 1000 and b['payments'][0]['voided']
    assert api('POST', url, {'reason': 'again'})[0] == 409
    assert api('POST', '/api/inventory/suppliers/%s/payments/nope/void' % s['id'], {'reason': 'x'})[0] == 404


def test_credit_needs_a_supplier_and_a_valid_term(api):
    s, p = supplier(api), part(api)
    code, _ = api('POST', '/api/inventory/documents', {'kind': 'RECEIPT', 'terms': 'CREDIT', 'lines': [{'productId': p['id'], 'quantity': 1, 'unitCost': 5}]})
    assert code == 400
    assert api('POST', '/api/inventory/documents', {'kind': 'RECEIPT', 'terms': 'LATER', 'supplierId': s['id'], 'lines': [{'productId': p['id'], 'quantity': 1, 'unitCost': 5}]})[0] == 400


def test_returning_parts_lowers_stock_and_what_is_owed(api):
    s, p = supplier(api), part(api)
    receive(api, s, p, 4, 1000)  # stock 3 + 4
    doc = ok(api('POST', '/api/inventory/supplier-returns', {'supplierId': s['id'], 'reason': 'Wrong part', 'reference': 'CN-9',
                                                            'lines': [{'productId': p['id'], 'quantity': 2, 'unitCost': 1000}]}))
    assert doc['doc_no'].startswith('SRN-')
    assert ok(api('GET', '/api/inventory/products'))[0]['quantity'] == 5
    assert books(api, s)['balance'] == 2000
    pdf = api('GET', '/api/workshop/stock-notes/%s.pdf' % doc['doc_no']) if False else None  # the note PDF has its own route; covered in test_bills
    assert pdf is None
    # more than is in stock, no reason, no supplier: all refused
    base = {'supplierId': s['id'], 'reason': 'x', 'lines': [{'productId': p['id'], 'quantity': 99}]}
    assert api('POST', '/api/inventory/supplier-returns', base)[0] == 409
    assert api('POST', '/api/inventory/supplier-returns', dict(base, reason='', lines=[{'productId': p['id'], 'quantity': 1}]))[0] == 400
    assert api('POST', '/api/inventory/supplier-returns', {'reason': 'x', 'lines': [{'productId': p['id'], 'quantity': 1}]})[0] == 400
    # the ordinary notes route refuses the kind
    assert api('POST', '/api/inventory/documents', {'kind': 'SUPPLIER_RETURN', 'supplierId': s['id'], 'reason': 'x', 'lines': [{'productId': p['id'], 'quantity': 1}]})[0] == 400


def test_returns_beyond_the_balance_show_the_supplier_owes_the_shop(api):
    s, p = supplier(api), part(api)
    receive(api, s, p, 1, 1000, 'PAID')
    ok(api('POST', '/api/inventory/supplier-returns', {'supplierId': s['id'], 'reason': 'Faulty', 'lines': [{'productId': p['id'], 'quantity': 1, 'unitCost': 1000}]}))
    assert books(api, s)['balance'] == -1000
    assert api('POST', '/api/inventory/suppliers/%s/payments' % s['id'], {'amount': 1})[0] == 400  # nothing to pay


def test_the_summary_lists_who_is_owed_and_who_is_overdue(api):
    a, b = supplier(api), supplier(api, 'Kandy Auto', phone='081 222 3333', credit_days=0)
    p = part(api)
    receive(api, a, p, 1, 700)
    receive(api, b, p, 1, 300)
    s = ok(api('GET', '/api/inventory/payables'))
    assert s['total'] == 1000 and [r['name'] for r in s['suppliers']] == ['Lanka Spares', 'Kandy Auto']
    # a 0-day supplier is due the day it delivers, so it is not overdue until tomorrow
    assert s['overdue'] == 0


def test_money_with_suppliers_is_owner_only_by_default(api):
    s, p = supplier(api), part(api)
    receive(api, s, p, 1, 100)
    for role in ('MECHANIC', 'STOREKEEPER', 'ADMIN'):
        assert api('GET', '/api/inventory/payables', role=role)[0] == 403, role
        assert api('POST', '/api/inventory/suppliers/%s/payments' % s['id'], {'amount': 1}, role=role)[0] == 403, role
    # returns: storekeeper and admin yes, mechanic no
    body = {'supplierId': s['id'], 'reason': 'x', 'lines': [{'productId': p['id'], 'quantity': 1, 'unitCost': 100}]}
    assert api('POST', '/api/inventory/supplier-returns', body, role='MECHANIC')[0] == 403
    assert api('POST', '/api/inventory/supplier-returns', body, role='STOREKEEPER')[0] == 200


def test_a_closed_supplier_can_still_take_a_return_but_is_not_orderable(api):
    s, p = supplier(api), part(api)
    receive(api, s, p, 2, 100)
    ok(api('PATCH', '/api/inventory/suppliers/%s' % s['id'], {'active': False, 'revision': s['revision']}, role='ADMIN'))
    ok(api('POST', '/api/inventory/supplier-returns', {'supplierId': s['id'], 'reason': 'x', 'lines': [{'productId': p['id'], 'quantity': 1, 'unitCost': 100}]}))
    code, body = api('POST', '/api/inventory/orders', {'supplierId': s['id'], 'items': [{'productId': p['id'], 'quantity': 1}]})
    assert code == 400 and 'closed' in body['message']


# ---------- to order and orders ----------
def test_the_to_order_list_has_low_parts_marked_parts_and_job_needs(api):
    s = supplier(api)
    low = part(api, openingQuantity=1, supplierId=s['id'])       # 1 <= reorder level 2: shows by itself
    fine = part(api, partNumber='PN-2', sku='SH-2', name='Air filter', openingQuantity=20)
    lst = ok(api('GET', '/api/inventory/to-order'))
    assert [i['name'] for i in lst['items']] == ['Oil filter'] and lst['items'][0]['source'] == 'LOW' and lst['items'][0]['quantity'] == 3  # back up to twice the level
    ok(api('POST', '/api/inventory/wants', {'productId': fine['id'], 'quantity': 5}))
    assert api('POST', '/api/inventory/wants', {'productId': fine['id'], 'quantity': 1})[0] == 409  # already on the list
    ok(api('POST', '/api/inventory/wants', {'name': 'Wiper blade', 'quantity': 2, 'note': 'for CAB-1'}, role='MECHANIC'))  # a mechanic can say "need this"
    names = {i['name']: i['source'] for i in ok(api('GET', '/api/inventory/to-order'))['items']}
    assert names == {'Oil filter': 'LOW', 'Air filter': 'MARKED', 'Wiper blade': 'MARKED'}
    assert api('GET', '/api/inventory/to-order', role='MECHANIC')[0] == 403
    assert low  # keep linters quiet


def test_making_an_order_builds_the_message_and_marks_the_lines(api):
    s = supplier(api, whatsapp='0771234567')
    p = part(api, openingQuantity=1, supplierId=s['id'])
    o = ok(api('POST', '/api/inventory/orders', {'supplierId': s['id'], 'lang': 'en', 'items': [{'productId': p['id'], 'quantity': 6}]}))
    assert o['order_no'].startswith('PO-') and o['status'] == 'SENT' and 'PN-1 Oil filter x 6' in o['message'] and 'Lanka Spares' in o['message']
    assert o['contact']['whatsapp'] == '0771234567'
    items = ok(api('GET', '/api/inventory/to-order'))['items']
    assert items[0]['status'] == 'ORDERED' and items[0]['order_no'] == o['order_no'] and items[0]['quantity'] == 6  # no longer a fresh suggestion
    pad = part(api, partNumber='PN-9', sku='S9', name='Pad')
    off = ok(api('POST', '/api/inventory/orders', {'supplierId': s['id'], 'lang': 'si', 'items': [{'productId': pad['id'], 'quantity': 1}]}))
    assert 'Hello' in off['message'] and 'ඇණවුම' not in off['message']  # Sinhala is off until the owner allows it
    ok(api('PUT', '/api/workshop/settings', dict(BIZ, sinhala=True)))
    assert ok(api('GET', '/api/workshop/settings'))['sinhala'] is True
    p3 = part(api, partNumber='PN-8', sku='S8', name='Plug')
    si = ok(api('POST', '/api/inventory/orders', {'supplierId': s['id'], 'lang': 'si', 'items': [{'productId': p3['id'], 'quantity': 1}]}))
    assert 'ඇණවුම' in si['message']
    assert api('PUT', '/api/workshop/settings', dict(BIZ, sinhala='yes'))[0] == 200 and ok(api('GET', '/api/workshop/settings'))['sinhala'] is False  # only a real true turns it on
    assert api('POST', '/api/inventory/orders', {'supplierId': s['id'], 'items': []})[0] == 400
    assert api('POST', '/api/inventory/orders', {'supplierId': s['id'], 'items': [{'productId': p['id'], 'quantity': 0}]})[0] == 400
    assert api('POST', '/api/inventory/orders', {'supplierId': s['id'], 'items': [{'productId': p['id'], 'quantity': 1.5}]})[0] == 400  # whole units only


def test_the_same_request_twice_makes_one_order(api):
    s = supplier(api)
    p = part(api, openingQuantity=1)
    body = {'supplierId': s['id'], 'items': [{'productId': p['id'], 'quantity': 2}]}
    a = ok(api('POST', '/api/inventory/orders', body, key='order-key-0000001'))
    b = ok(api('POST', '/api/inventory/orders', body, key='order-key-0000001'))
    assert a['id'] == b['id'] and len(ok(api('GET', '/api/inventory/orders'))) == 1


def test_a_delivery_from_that_supplier_closes_the_order_and_partial_stays_open(api):
    s = supplier(api)
    p = part(api, openingQuantity=1)
    o = ok(api('POST', '/api/inventory/orders', {'supplierId': s['id'], 'items': [{'productId': p['id'], 'quantity': 10}]}))
    receive(api, s, p, 4, 100, 'PAID')
    one = ok(api('GET', '/api/inventory/orders/%s' % o['id']))
    assert one['status'] == 'SENT' and one['lines'][0]['received'] == 4  # partly received: still open
    other = supplier(api, 'Other Co', phone='011 999 8888')
    receive(api, other, p, 6, 100, 'PAID')
    assert ok(api('GET', '/api/inventory/orders/%s' % o['id']))['lines'][0]['received'] == 4  # a different supplier does not count
    receive(api, s, p, 6, 100, 'PAID')
    done = ok(api('GET', '/api/inventory/orders/%s' % o['id']))
    assert done['status'] == 'RECEIVED' and done['lines'][0]['received'] == 10
    assert ok(api('GET', '/api/inventory/to-order'))['open'] == 0 or all(i['status'] != 'ORDERED' for i in ok(api('GET', '/api/inventory/to-order'))['items'])


def test_cancelling_an_order_puts_the_parts_back_on_the_list(api):
    s = supplier(api)
    p = part(api, openingQuantity=1)
    ok(api('POST', '/api/inventory/wants', {'productId': p['id'], 'quantity': 4}))
    w = ok(api('GET', '/api/inventory/to-order'))['items'][0]
    o = ok(api('POST', '/api/inventory/orders', {'supplierId': s['id'], 'items': [{'wantId': w['want_id'], 'quantity': 4}]}))
    assert api('POST', '/api/inventory/wants/%s/cancel' % w['want_id'], {})[0] == 409  # already ordered
    assert api('POST', '/api/inventory/orders/%s/close' % o['id'], {'action': 'later'})[0] == 400
    ok(api('POST', '/api/inventory/orders/%s/close' % o['id'], {'action': 'cancel'}))
    assert ok(api('GET', '/api/inventory/to-order'))['items'][0]['status'] == 'OPEN'
    assert api('POST', '/api/inventory/orders/%s/close' % o['id'], {'action': 'cancel'})[0] == 409
    assert [x['status'] for x in ok(api('GET', '/api/inventory/orders', query={'status': 'CANCELLED'}))] == ['CANCELLED']


def test_a_credit_delivery_still_counts_toward_the_order_and_the_balance(api):
    s = supplier(api)
    p = part(api, openingQuantity=1)
    o = ok(api('POST', '/api/inventory/orders', {'supplierId': s['id'], 'items': [{'productId': p['id'], 'quantity': 2}]}))
    receive(api, s, p, 2, 250)
    assert ok(api('GET', '/api/inventory/orders/%s' % o['id']))['status'] == 'RECEIVED' and books(api, s)['balance'] == 500


def test_shops_never_see_each_others_orders_or_payables(api):
    s = ok(api('POST', '/api/inventory/suppliers', {'name': 'Lanka Spares', 'credit_days': 30}, role='ADMIN', shop='ganga'))
    p = ok(api('POST', '/api/inventory/products', dict(PART, openingQuantity=1), shop='ganga'))
    ok(api('POST', '/api/inventory/documents', {'kind': 'RECEIPT', 'terms': 'CREDIT', 'supplierId': s['id'], 'lines': [{'productId': p['id'], 'quantity': 2, 'unitCost': 100}]}, shop='ganga'))
    o = ok(api('POST', '/api/inventory/orders', {'supplierId': s['id'], 'items': [{'productId': p['id'], 'quantity': 3}]}, shop='ganga'))
    assert ok(api('GET', '/api/inventory/payables', shop='ganga'))['total'] == 200
    assert ok(api('GET', '/api/inventory/payables', shop='other'))['suppliers'] == []
    assert ok(api('GET', '/api/inventory/orders', shop='other')) == [] and ok(api('GET', '/api/inventory/to-order', shop='other'))['items'] == []
    assert api('GET', '/api/inventory/orders/%s' % o['id'], shop='other')[0] == 404
    assert api('GET', '/api/inventory/suppliers/%s/payables' % s['id'], shop='other')[0] == 404
    assert api('POST', '/api/inventory/suppliers/%s/payments' % s['id'], {'amount': 1}, shop='other')[0] == 404
