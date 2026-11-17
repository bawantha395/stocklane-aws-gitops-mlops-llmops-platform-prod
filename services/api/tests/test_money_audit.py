"""Money audit: one bill taken through payment, return, refund and void, checking stock, the bill, the profit and the report after every step."""
from datetime import timedelta
from decimal import Decimal

from test_job_stock import new_job, use
from test_money_flow import BIZ, ok
from test_stock_count import product, stock


def setup(api, reg='CAB-1234', qty=2):
    ok(api('PUT', '/api/workshop/settings', BIZ))
    p, job = product(api, 10), new_job(api, reg)
    ok(api('POST', '/api/inventory/movements', {'productId': p['id'], 'kind': 'RECEIPT', 'quantity': 2, 'unitCost': 900, 'supplier': 'ABC'}))  # 12 on the shelf, cost 900
    j = ok(use(api, job, p['id'], qty))
    j = ok(api('PATCH', '/api/workshop/jobs/%s' % j['id'], {'revision': j['revision'], 'discount': 100, 'labour': [{'description': 'Service', 'amount': 2500}],
                                                          'parts': j['parts'] + [{'name': 'Bulb', 'quantity': 1, 'unit_price': 500, 'outside': True, 'outside_cost': 300, 'outside_shop': 'Kade'}]}))
    return p, j


def report(api):
    return ok(api('GET', '/api/workshop/report'))


def checks(r):
    """Sums that must hold on any report."""
    assert r['received_gross'] - r['refunds'] == r['received']
    assert sum(Decimal(str(m['amount'])) for m in r['by_method']) == r['received']
    assert r['parts_total'] + r['labour_total'] - r['discount'] + r['tax'] == r['total']
    p = r['profit']
    assert p['parts_margin'] + p['labour'] - p['discount'] == p['profit']


def test_one_bill_from_job_to_refund(api):
    p, j = setup(api)
    # the job already knows what it will earn; the mechanic never sees it
    full = ok(api('GET', '/api/workshop/jobs/%s' % j['id']))
    assert full['profit'] == {'parts_sales': 4100, 'parts_cost': 2100, 'parts_margin': 2000, 'labour': 2500, 'discount': 100, 'profit': 4400, 'unknown': 0}
    seen = ok(api('GET', '/api/workshop/jobs/%s' % j['id'], role='MECHANIC'))
    assert 'profit' not in seen and all('cost_each' not in x and 'outside_cost' not in x for x in seen['parts'])
    assert stock(api, p['id']) == 10
    inv = ok(api('POST', '/api/workshop/jobs/%s/invoice' % j['id'], {'revision': j['revision']}))
    assert inv['total'] == 6500  # 2 x 1800 + 500 + 2500 - 100
    r = report(api); checks(r)
    assert r['total'] == 6500 and r['received'] == 0 and r['unpaid'] == 6500 and r['profit']['profit'] == 4400 and r['refunds'] == 0 and r['voids'] == []
    # part payment
    ok(api('POST', '/api/workshop/invoices/%s/payments' % inv['id'], {'amount': 3000, 'method': 'CASH'}))
    r = report(api); checks(r)
    assert r['received'] == 3000 and r['unpaid'] == 3500
    # one stock part comes back: stock up, bill down, no money back (the customer has paid less than the new total)
    done = ok(api('POST', '/api/workshop/invoices/%s/return' % inv['id'], {'lines': [{'index': 0, 'quantity': 1}], 'reason': 'Wrong part'}))
    assert done['total'] == 4700 and done['paid'] == 3000 and done['status'] == 'PARTIAL' and stock(api, p['id']) == 11
    r = report(api); checks(r)
    assert r['total'] == 4700 and r['returns'] == 1800 and r['return_list'][0]['reason'] == 'Wrong part' and r['refunds'] == 0
    assert r['profit'] == {'parts_sales': 2300, 'parts_cost': 1200, 'parts_margin': 1100, 'labour': 2500, 'discount': 100, 'profit': 3500, 'unknown': 0}
    # the printable return note
    code, pdf = api('GET', '/api/workshop/invoices/%s/returns/%s/pdf' % (inv['id'], done['credits'][0]['id']))
    assert code == 200 and pdf['filename'] == 'RN-%s-1.pdf' % inv['invoice_number'] and len(pdf['pdf']) > 1000
    assert api('GET', '/api/workshop/invoices/%s/returns/nope/pdf' % inv['id'])[0] == 404
    assert api('GET', '/api/workshop/invoices/%s/returns/%s/pdf' % (inv['id'], done['credits'][0]['id']), role='STOREKEEPER')[0] == 403
    # the rest is paid, then some money is given back
    ok(api('POST', '/api/workshop/invoices/%s/payments' % inv['id'], {'amount': 1700, 'method': 'CARD'}))
    assert api('POST', '/api/workshop/invoices/%s/payments' % inv['id'], {'amount': 1, 'method': 'CASH'})[0] == 409  # nothing is owed
    back = ok(api('POST', '/api/workshop/invoices/%s/refund' % inv['id'], {'amount': 400, 'method': 'CASH', 'reason': 'Goodwill'}))
    assert back['paid'] == 4300 and back['status'] == 'PARTIAL'
    r = report(api); checks(r)
    assert r['received_gross'] == 4700 and r['refunds'] == 400 and r['received'] == 4300
    assert r['refund_list'][0]['reason'] == 'Goodwill' and r['refund_list'][0]['amount'] == 400 and r['refund_list'][0]['by']
    # a bill with money on it cannot be voided; stock did not move through any of the money steps
    assert api('POST', '/api/workshop/invoices/%s/void' % inv['id'], {'reason': 'x'})[0] == 409
    assert stock(api, p['id']) == 11
    # the report without the see-cost permission carries no profit
    v = ok(api('GET', '/api/workshop/permissions'))
    ok(api('PUT', '/api/workshop/permissions', {'roles': dict(v['roles'], ADMIN=v['roles']['ADMIN'] + ['reports'])}))
    seen = ok(api('GET', '/api/workshop/report', role='ADMIN'))
    assert 'profit' not in seen and seen['refunds'] == 400


def test_everything_returned_and_refunded_is_no_sale(api):
    p, j = setup(api, qty=1)
    j = ok(api('PATCH', '/api/workshop/jobs/%s' % j['id'], {'revision': j['revision'], 'discount': 0, 'labour': [], 'parts': j['parts'][:1]}))
    inv = ok(api('POST', '/api/workshop/jobs/%s/invoice' % j['id'], {'revision': j['revision']}))
    ok(api('POST', '/api/workshop/invoices/%s/payments' % inv['id'], {'amount': 1800, 'method': 'CASH'}))
    done = ok(api('POST', '/api/workshop/invoices/%s/return' % inv['id'], {'lines': [{'index': 0, 'quantity': 1}], 'reason': 'Changed mind', 'refundMethod': 'CASH'}))
    assert done['status'] == 'REFUNDED' and done['total'] == 0 and done['paid'] == 0 and stock(api, p['id']) == 12
    r = report(api); checks(r)
    assert r['total'] == 0 and r['invoices'] == 0 and r['received'] == 0 and r['received_gross'] == 1800 and r['refunds'] == 1800 and r['returns'] == 1800
    assert r['profit']['profit'] == 0 and r['unpaid'] == 0 and r['outstanding_all_time'] == 0
    assert api('POST', '/api/workshop/invoices/%s/payments' % inv['id'], {'amount': 100, 'method': 'CASH'})[0] == 409  # nothing to pay on a returned bill
    code, pdf = api('GET', '/api/workshop/invoices/%s/returns/%s/pdf' % (inv['id'], done['credits'][0]['id']))
    assert code == 200


def test_void_needs_a_reason_and_shows_in_the_report(api):
    p, j = setup(api)
    inv = ok(api('POST', '/api/workshop/jobs/%s/invoice' % j['id'], {'revision': j['revision']}))
    assert api('POST', '/api/workshop/invoices/%s/void' % inv['id'], {})[0] == 400
    assert api('POST', '/api/workshop/invoices/%s/void' % inv['id'], {'reason': '  '})[0] == 400
    ok(api('POST', '/api/workshop/invoices/%s/void' % inv['id'], {'reason': 'Billed the wrong car'}))
    r = report(api); checks(r)
    assert r['total'] == 0 and r['invoices'] == 0 and r['void_count'] == 1 and r['profit']['profit'] == 0
    v = r['voids'][0]
    assert v['invoice_number'] == inv['invoice_number'] and v['reason'] == 'Billed the wrong car' and v['by'] and v['total'] == 6500
    # the job is open again with its parts still on it; stock did not move
    again = ok(api('GET', '/api/workshop/jobs/%s' % j['id']))
    assert again['status'] == 'OPEN' and again['voids'][0]['reason'] == 'Billed the wrong car' and stock(api, p['id']) == 10
    # billed again: a new number, and the sale counts once
    inv2 = ok(api('POST', '/api/workshop/jobs/%s/invoice' % j['id'], {'revision': again['revision']}))
    r = report(api); checks(r)
    assert inv2['invoice_number'] != inv['invoice_number'] and r['total'] == 6500 and r['invoices'] == 1 and r['void_count'] == 1


def test_a_part_with_no_known_cost_is_left_out_of_profit(api):
    ok(api('PUT', '/api/workshop/settings', BIZ))
    p, job = product(api, 5), new_job(api, 'CAB-5555')  # opening stock, no cost ever entered
    j = ok(use(api, job, p['id'], 1))
    j = ok(api('PATCH', '/api/workshop/jobs/%s' % j['id'], {'revision': j['revision'], 'parts': j['parts'] + [{'name': 'Clip', 'quantity': 2, 'unit_price': 50, 'outside': True}]}))
    full = ok(api('GET', '/api/workshop/jobs/%s' % j['id']))
    assert full['profit']['unknown'] == 2 and full['profit']['parts_sales'] == 1900 and full['profit']['parts_cost'] == 0 and full['profit']['profit'] == 0
    # the owner enters the cost later (a delivery): the open job follows the part's last cost
    ok(api('POST', '/api/inventory/movements', {'productId': p['id'], 'kind': 'RECEIPT', 'quantity': 1, 'unitCost': 1000}))
    full = ok(api('GET', '/api/workshop/jobs/%s' % j['id']))
    assert full['profit']['unknown'] == 1 and full['profit']['parts_cost'] == 1000 and full['profit']['profit'] == 800


def test_an_estimate_that_ran_out_cannot_be_approved(api):
    from stocklane_api import workshop
    old = (workshop.today() - timedelta(days=2)).isoformat()
    q = ok(api('POST', '/api/workshop/quotes', {'registration': 'CAB-7000', 'customer': 'Nimal', 'kind': 'ESTIMATE', 'valid_until': (workshop.today() + timedelta(days=5)).isoformat(),
                                                'parts': [{'name': 'Pad', 'quantity': 1, 'unit_price': 100}], 'labour': []}))
    ok(api('POST', '/api/workshop/quotes/%s/status' % q['id'], {'status': 'SENT', 'revision': q['revision']}))
    # time passes: put the date in the past the way the table would hold it
    import boto3
    boto3.resource('dynamodb').Table('test-table').update_item(Key={'pk': 'T#main#WQUO', 'sk': q['id']}, UpdateExpression='SET valid_until = :v', ExpressionAttributeValues={':v': old})
    cur = ok(api('GET', '/api/workshop/quotes/%s' % q['id']))
    assert cur['expired']
    code, body = api('POST', '/api/workshop/quotes/%s/status' % q['id'], {'status': 'APPROVED', 'revision': cur['revision']})
    assert code == 409 and 'ran out' in body['message']
    # a new date makes it good again
    fresh = ok(api('PATCH', '/api/workshop/quotes/%s' % q['id'], dict(cur, valid_until=(workshop.today() + timedelta(days=7)).isoformat())))
    ok(api('POST', '/api/workshop/quotes/%s/status' % q['id'], {'status': 'APPROVED', 'revision': fresh['revision']}))
