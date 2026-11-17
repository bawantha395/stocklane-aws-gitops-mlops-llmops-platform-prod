"""Quick bill: a counter sale or small job billed in one call, safe to retry, and never leaving a half-made job behind."""
from clock import today
from test_money_flow import ok
from test_stock_count import product, stock

KEY = 'quick-bill-key-000000001'


def qb(api, body, key=KEY, role='MECHANIC'):
    return api('POST', '/api/workshop/quick-bill', body, role=role, key=key)


def test_cash_sale_takes_stock_bills_and_is_paid_in_full(api):
    p = product(api, 10)
    code, inv = qb(api, {'lines': [{'productId': p['id'], 'quantity': 3}], 'labour': [{'description': 'Fitting', 'amount': 500}]})
    assert code == 200 and inv['status'] == 'PAID' and inv['total'] == 5900 and inv['paid'] == 5900 and inv['customer'] == 'Walk-in customer'
    assert stock(api, p['id']) == 7
    assert qb(api, {'lines': [{'productId': p['id'], 'quantity': 3}], 'labour': [{'description': 'Fitting', 'amount': 500}]})[1]['id'] == inv['id']  # a retry is the same bill
    assert stock(api, p['id']) == 7 and len(ok(api('GET', '/api/workshop/invoices'))) == 1


def test_credit_sale_stays_unpaid_with_the_customer_and_part_payment_works(api):
    p = product(api, 10)
    inv = ok(qb(api, {'lines': [{'productId': p['id'], 'quantity': 1}], 'invoice_type': 'CREDIT', 'customer': 'Kamal Stores', 'phone': '0771234567'}, key='quick-bill-key-000000002'))
    assert inv['status'] == 'UNPAID' and inv['paid'] == 0 and inv['invoice_type'] == 'CREDIT' and inv['customer'] == 'Kamal Stores'
    part = ok(qb(api, {'lines': [{'productId': p['id'], 'quantity': 1}], 'invoice_type': 'CREDIT', 'paid': 500}, key='quick-bill-key-000000003'))
    assert part['status'] == 'PARTIAL' and part['paid'] == 500


def test_not_enough_stock_leaves_nothing_behind(api):
    p = product(api, 2)
    assert qb(api, {'lines': [{'productId': p['id'], 'quantity': 5}]})[0] == 409
    assert stock(api, p['id']) == 2 and ok(api('GET', '/api/workshop/invoices')) == []
    assert [j for j in ok(api('GET', '/api/workshop/jobs')) if j['status'] == 'OPEN'] == []  # the empty job was taken back
    assert qb(api, {}, key='quick-bill-key-000000004')[0] == 400
    assert qb(api, {'lines': [{'productId': p['id'], 'quantity': 1}]}, role='STOREKEEPER', key='quick-bill-key-000000005')[0] == 403


def test_labour_only_and_discount_limit_for_a_mechanic(api):
    inv = ok(qb(api, {'labour': [{'description': 'Wash', 'amount': 1000}]}, key='quick-bill-key-000000006'))
    assert inv['total'] == 1000 and inv['status'] == 'PAID'
    assert qb(api, {'labour': [{'description': 'Wash', 'amount': 1000}], 'discount': 600}, key='quick-bill-key-000000007')[0] == 400  # a mechanic may give up to 10%
    assert [j for j in ok(api('GET', '/api/workshop/jobs')) if j['status'] == 'OPEN'] == []


def test_report_shows_each_mechanic_with_labour_average_and_hours(api):
    from datetime import date, timedelta
    p = product(api, 10)
    ok(qb(api, {'lines': [{'productId': p['id'], 'quantity': 1}], 'labour': [{'description': 'Fitting', 'amount': 500}], 'mechanic': 'Nuwan'}, key='quick-bill-key-000000009'))
    rep = ok(api('GET', '/api/workshop/report', query={'from': (today() - timedelta(days=1)).isoformat(), 'until': (today() + timedelta(days=1)).isoformat()}))
    row = next(m for m in rep['by_mechanic'] if m['mechanic'] == 'Nuwan')
    assert row['jobs'] == 1 and row['labour'] == 500 and row['average'] == row['total'] and row['hours'] is not None and row['hours'] >= 0
