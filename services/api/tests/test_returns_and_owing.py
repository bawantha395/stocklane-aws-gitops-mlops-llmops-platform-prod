"""Parts that come back after the bill, a returning customer who still owes, and the per-item stock movement report."""
from clock import today
from datetime import date, timedelta

from test_job_stock import new_job, use
from test_money_flow import BIZ, ok
from test_stock_count import product, stock


def invoiced(api, qty=3, reg='CAB-1234'):
    ok(api('PUT', '/api/workshop/settings', BIZ))
    p, job = product(api, 10), new_job(api, reg)
    j = ok(use(api, job, p['id'], qty))
    inv = ok(api('POST', '/api/workshop/jobs/%s/invoice' % j['id'], {'revision': j['revision']}, role='MECHANIC'))
    return p, inv


def test_return_after_invoice_restocks_and_lowers_the_bill(api):
    p, inv = invoiced(api, 3)
    assert stock(api, p['id']) == 7 and inv['total'] == 5400
    ok(api('POST', '/api/workshop/invoices/%s/payments' % inv['id'], {'amount': 5400, 'method': 'CASH'}, role='MECHANIC'))
    # a mechanic cannot do this
    assert api('POST', '/api/workshop/invoices/%s/return' % inv['id'], {'lines': [{'index': 0, 'quantity': 1}], 'reason': 'x'}, role='MECHANIC')[0] == 403
    # one part back, customer already paid in full: the money must go back, so a method is needed when asked
    done = ok(api('POST', '/api/workshop/invoices/%s/return' % inv['id'], {'lines': [{'index': 0, 'quantity': 1}], 'reason': 'Wrong part', 'refundMethod': 'CASH'}))
    assert done['total'] == 3600 and done['credit_total'] == 1800 and done['paid'] == 3600 and done['status'] == 'PAID'
    assert done['payments'][-1]['amount'] == -1800 and done['payments'][-1]['refund'] is True
    assert stock(api, p['id']) == 8
    moves = [m for m in ok(api('GET', '/api/inventory/movements', role='MECHANIC')) if m['kind'] == 'RETURN']
    assert len(moves) == 1 and moves[0]['quantity'] == 1 and inv['invoice_number'] in moves[0]['note']
    # the returned part has its own numbered note, and it prints
    assert moves[0]['doc_no'].startswith('RTN-')
    assert ok(api('GET', '/api/inventory/movements/%s/note.pdf' % moves[0]['id']))['pdf']
    # cannot return more than is left (3 bought, 1 already back)
    assert api('POST', '/api/workshop/invoices/%s/return' % inv['id'], {'lines': [{'index': 0, 'quantity': 3}], 'reason': 'x'})[0] == 409
    done = ok(api('POST', '/api/workshop/invoices/%s/return' % inv['id'], {'lines': [{'index': 0, 'quantity': 2}], 'reason': 'Rest too', 'refundMethod': 'CASH'}))
    assert done['total'] == 0 and done['paid'] == 0 and stock(api, p['id']) == 10 and len(done['credits']) == 2


def test_return_on_unpaid_bill_needs_no_refund(api):
    p, inv = invoiced(api, 2)
    done = ok(api('POST', '/api/workshop/invoices/%s/return' % inv['id'], {'lines': [{'index': 0, 'quantity': 1}], 'reason': 'Not needed'}))
    assert done['total'] == 1800 and done['paid'] == 0 and done['status'] == 'UNPAID' and stock(api, p['id']) == 9


def test_history_shows_payment_status_and_owing_is_found(api):
    p, inv = invoiced(api, 2, 'KV-9087')
    ok(api('POST', '/api/workshop/invoices/%s/payments' % inv['id'], {'amount': 1000, 'method': 'CASH'}, role='MECHANIC'))
    v = ok(api('GET', '/api/workshop/vehicles/KV9087', role='MECHANIC'))
    row = v['history'][0]
    assert row['pay_status'] == 'PARTIAL' and row['paid'] == 1000 and row['balance'] == 2600
    # the same registration, however it is typed, and the same phone on another vehicle
    assert ok(api('GET', '/api/workshop/owing', query={'reg': 'kv 9087'}, role='MECHANIC'))[0]['balance'] == 2600
    assert ok(api('GET', '/api/workshop/owing', query={'reg': 'ABC1234', 'phone': '077 123 4567'}, role='MECHANIC'))[0]['invoice_number'] == inv['invoice_number']
    assert ok(api('GET', '/api/workshop/owing', query={'reg': 'ZZ9999', 'phone': '0710000000'}, role='MECHANIC')) == []
    ok(api('POST', '/api/workshop/invoices/%s/payments' % inv['id'], {'amount': 2600, 'method': 'CASH'}, role='MECHANIC'))
    assert ok(api('GET', '/api/workshop/owing', query={'reg': 'KV9087'}, role='MECHANIC')) == []
    # PDFs still build with the payment lines and the owner log
    ok(api('POST', '/api/workshop/vehicles/KV9087/owner', {'owner': 'Chamara', 'phone': '0710901847'}, role='MECHANIC'))
    assert ok(api('GET', '/api/workshop/vehicles/KV9087/history.pdf', role='MECHANIC'))['pdf']


def test_stock_movement_report_splits_came_in_out_returned(api):
    p, inv = invoiced(api, 3)
    ok(api('POST', '/api/workshop/invoices/%s/return' % inv['id'], {'lines': [{'index': 0, 'quantity': 1}], 'reason': 'Wrong part'}))
    a, b = today() - timedelta(days=1), today() + timedelta(days=2)
    q = {'from': a.isoformat() + 'T00:00:00+05:30', 'until': b.isoformat() + 'T00:00:00+05:30'}
    row = next(r for r in ok(api('GET', '/api/inventory/analysis', query=q))['rows'] if r['id'] == p['id'])
    assert row['came_in_quantity'] == 10 and row['taken_quantity'] == 3 and row['returned_quantity'] == 1 and row['closing_quantity'] == 8
    assert ok(api('GET', '/api/inventory/analysis.pdf', query=q))['pdf']
    assert api('GET', '/api/inventory/analysis.pdf', query=q, role='MECHANIC')[0] == 403


def test_grn_and_gin_numbers_and_notes(api):
    from test_stock_count import product
    p = product(api, 5)
    rec = ok(api('POST', '/api/inventory/movements', {'kind': 'RECEIPT', 'productId': p['id'], 'quantity': 4, 'supplier': 'Lanka Spares', 'reference': 'DN-778'}, role='MECHANIC'))
    assert rec['doc_no'].startswith('GRN-') and rec['supplier'] == 'Lanka Spares' and rec['reference'] == 'DN-778'
    out = ok(api('POST', '/api/inventory/movements', {'kind': 'STOCK_OUT', 'productId': p['id'], 'quantity': 2}, role='MECHANIC'))
    assert out['doc_no'].startswith('GIN-')
    assert ok(api('GET', '/api/inventory/movements/%s/note.pdf' % rec['id'], role='MECHANIC'))['pdf']
    assert ok(api('GET', '/api/inventory/movements/%s/note.pdf' % out['id'], role='MECHANIC'))['pdf']
    listed = {m['id']: m for m in ok(api('GET', '/api/inventory/movements', role='MECHANIC'))}
    assert listed[rec['id']]['doc_no'] == rec['doc_no']
    undo = ok(api('POST', '/api/inventory/movements', {'kind': 'RECEIPT', 'productId': p['id'], 'quantity': 1, 'note': 'Undo of a counter entry'}, role='MECHANIC'))
    assert 'doc_no' not in undo


def test_cost_price_mechanic_types_owner_reads(api):
    from test_stock_count import product
    p = product(api, 5)
    first = ok(api('POST', '/api/inventory/movements', {'kind': 'RECEIPT', 'productId': p['id'], 'quantity': 4, 'unitCost': '1200'}, role='MECHANIC'))
    assert 'unit_cost' not in first  # a mechanic never reads the price back
    second = ok(api('POST', '/api/inventory/movements', {'kind': 'RECEIPT', 'productId': p['id'], 'quantity': 2, 'unitCost': '1350.50'}))
    assert second['unit_cost'] == 1350.5
    assert api('POST', '/api/inventory/movements', {'kind': 'RECEIPT', 'productId': p['id'], 'quantity': 1, 'unitCost': '-3'}, role='MECHANIC')[0] == 400
    assert api('POST', '/api/inventory/movements', {'kind': 'RECEIPT', 'productId': p['id'], 'quantity': 1, 'unitCost': '1.234'}, role='MECHANIC')[0] == 400
    # no cost given is fine
    ok(api('POST', '/api/inventory/movements', {'kind': 'RECEIPT', 'productId': p['id'], 'quantity': 1}, role='MECHANIC'))
    mech = ok(api('GET', '/api/inventory/products', role='MECHANIC'))
    assert all('last_cost' not in x and 'prev_cost' not in x for x in mech)
    assert all('unit_cost' not in m for m in ok(api('GET', '/api/inventory/movements', role='MECHANIC')))
    own = {x['id']: x for x in ok(api('GET', '/api/inventory/products'))}[p['id']]
    assert own['last_cost'] == 1350.5 and own['prev_cost'] == 1200
    assert {m['id']: m for m in ok(api('GET', '/api/inventory/movements'))}[first['id']]['unit_cost'] == 1200
    # the owner can fill a missing cost or correct a wrong one; a mechanic cannot
    assert api('POST', '/api/inventory/movements/%s/cost' % first['id'], {'unitCost': 1250}, role='MECHANIC')[0] == 403
    ok(api('POST', '/api/inventory/movements/%s/cost' % first['id'], {'unitCost': 1250}))
    assert {m['id']: m for m in ok(api('GET', '/api/inventory/movements'))}[first['id']]['unit_cost'] == 1250
    # margin in the owner's stock report
    from datetime import date, timedelta
    rep = ok(api('GET', '/api/inventory/analysis', query={'from': today().isoformat() + 'T00:00:00+05:30', 'until': (today() + timedelta(days=2)).isoformat() + 'T00:00:00+05:30'}))
    row = [r for r in rep['rows'] if r['id'] == p['id']][0]
    assert row['last_cost'] == 1350.5 and row['margin'] == row['selling_price'] - 1350.5
    # printed note: price only on the owner's request
    assert ok(api('GET', '/api/inventory/movements/%s/note.pdf' % second['id'], query={'cost': '1'}))['pdf']


def test_job_no_chassis_invoice_type_and_date_out(api):
    ok(api('PUT', '/api/workshop/settings', BIZ))
    p = product(api, 10)
    ja, jb = new_job(api, 'CAB-5001'), new_job(api, 'CAB-5002')
    a = ja['id']
    assert ja['job_no'] == 'JOB-0001' and jb['job_no'] == 'JOB-0002' and ja['invoice_type'] == 'CASH'
    # chassis and invoice type are saved on the job, the chassis stays on the vehicle file
    saved = ok(api('PATCH', '/api/workshop/jobs/%s' % a, {'revision': ja['revision'], 'chassis': 'zvw30-123456', 'invoice_type': 'insurance'}, role='MECHANIC'))
    assert saved['chassis'] == 'ZVW30-123456' and saved['invoice_type'] == 'INSURANCE'
    assert ok(api('GET', '/api/workshop/vehicles/CAB-5001'))['chassis'] == 'ZVW30-123456'
    assert api('PATCH', '/api/workshop/jobs/%s' % a, {'revision': saved['revision'], 'invoice_type': 'barter'}, role='MECHANIC')[0] == 400
    # date out: set when the bill is made, and the bill carries the job no
    j = ok(use(api, ok(api('GET', '/api/workshop/jobs/%s' % a)), p['id'], 1))
    inv = ok(api('POST', '/api/workshop/jobs/%s/invoice' % j['id'], {'revision': j['revision']}, role='MECHANIC'))
    assert inv['job_no'] == 'JOB-0001' and inv['invoice_type'] == 'INSURANCE' and inv['chassis'] == 'ZVW30-123456'
    assert ok(api('GET', '/api/workshop/jobs/%s' % a))['out_at']
    # a job made from an estimate also gets the next number and keeps the chassis
    q = ok(api('POST', '/api/workshop/quotes', {'registration': 'CAB-5003', 'customer': 'X', 'chassis': 'abc 1', 'insurer': 'Allianz', 'labour': [{'description': 'Fix', 'amount': 1000, 'section': 'Other'}]}))
    ok(api('POST', '/api/workshop/quotes/%s/status' % q['id'], {'status': 'SENT', 'revision': q['revision']}))
    q = ok(api('GET', '/api/workshop/quotes/%s' % q['id']))
    ok(api('POST', '/api/workshop/quotes/%s/status' % q['id'], {'status': 'APPROVED', 'revision': q['revision']}))
    q = ok(api('GET', '/api/workshop/quotes/%s' % q['id']))
    made = ok(api('POST', '/api/workshop/quotes/%s/convert' % q['id'], {'revision': q['revision']}))
    jj = ok(api('GET', '/api/workshop/jobs/%s' % made['job_id']))
    assert jj['job_no'] == 'JOB-0003' and jj['chassis'] == 'ABC1' and jj['invoice_type'] == 'INSURANCE'


def test_usual_supplier_on_item(api):
    p = ok(api('POST', '/api/inventory/products', {'sku': 'SUP-1', 'name': 'Filter', 'category': 'Filters', 'brand': 'Bosch', 'partNumber': 'F-100', 'unit': 'UNIT',
                                                    'sellingPrice': 500, 'reorderLevel': 2, 'openingQuantity': 0, 'supplier': ' Lanka Spares '}, role='MECHANIC'))
    assert p['supplier'] == 'Lanka Spares'
    q = ok(api('POST', '/api/inventory/products', {'sku': 'SUP-2', 'name': 'Belt', 'category': 'Belts', 'brand': 'Gates', 'partNumber': 'B-200', 'unit': 'UNIT',
                                                    'sellingPrice': 800, 'reorderLevel': 2, 'openingQuantity': 0}, role='MECHANIC'))
    assert not q.get('supplier')
    # the first delivery names the usual supplier; a later one does not replace it
    ok(api('POST', '/api/inventory/movements', {'kind': 'RECEIPT', 'productId': q['id'], 'quantity': 2, 'supplier': 'Colombo Parts'}, role='MECHANIC'))
    ok(api('POST', '/api/inventory/movements', {'kind': 'RECEIPT', 'productId': q['id'], 'quantity': 1, 'supplier': 'Other Shop'}, role='MECHANIC'))
    got = {x['id']: x for x in ok(api('GET', '/api/inventory/products', role='MECHANIC'))}
    assert got[q['id']]['supplier'] == 'Colombo Parts' and got[p['id']]['supplier'] == 'Lanka Spares'
    # only the owner edits it afterwards
    body = {'name': 'Belt', 'category': 'Belts', 'brand': 'Gates', 'partNumber': 'B-200', 'reorderLevel': 2, 'supplier': 'New Supplier'}
    assert api('PATCH', '/api/inventory/products/%s' % q['id'], body, role='MECHANIC')[0] == 403
    assert ok(api('PATCH', '/api/inventory/products/%s' % q['id'], body))['supplier'] == 'New Supplier'
    assert {c['id']: c for c in ok(api('GET', '/api/inventory/catalogue', role='MECHANIC'))}[q['id']]['supplier'] == 'New Supplier'


def test_old_records_without_the_new_fields_still_work(api):
    """Jobs, items and receipts saved before Job No, chassis, invoice type, supplier and cost existed must keep working."""
    from stocklane_api import core
    ok(api('PUT', '/api/workshop/settings', BIZ))
    p = product(api, 10)
    job = new_job(api, 'CAB-9001')
    core.transact([core.update('WJOB', job['id'], 'REMOVE job_no, chassis, invoice_type SET legacy = :z', {':z': 1}),
                   core.update('VEHICLE', 'CAB9001', 'REMOVE chassis SET legacy = :z', {':z': 1}),
                   core.update('PRODUCT', p['id'], 'REMOVE supplier, last_cost, prev_cost SET legacy = :z', {':z': 1})], [None] * 3)
    old = ok(api('GET', '/api/workshop/jobs/%s' % job['id']))
    assert 'job_no' not in old and old['status'] == 'OPEN'
    assert any(j['id'] == job['id'] for j in ok(api('GET', '/api/workshop/jobs')))
    assert ok(api('GET', '/api/workshop/dashboard'))['open_count'] >= 1
    j = ok(use(api, old, p['id'], 2))
    saved = ok(api('PATCH', '/api/workshop/jobs/%s' % job['id'], {'revision': j['revision'], 'summary': 'Service again'}, role='MECHANIC'))
    assert saved['summary'] == 'Service again'
    inv = ok(api('POST', '/api/workshop/jobs/%s/invoice' % job['id'], {'revision': saved['revision']}, role='MECHANIC'))
    assert inv['total'] > 0 and 'job_no' not in inv
    assert ok(api('GET', '/api/workshop/vehicles/CAB-9001'))['history']
    assert ok(api('GET', '/api/workshop/invoices/%s/pdf' % inv['id'], role='MECHANIC'))['pdf']
    # an old receipt with no cost still prints a GRN and lists for the mechanic
    rec = ok(api('POST', '/api/inventory/movements', {'kind': 'RECEIPT', 'productId': p['id'], 'quantity': 1}, role='MECHANIC'))
    assert ok(api('GET', '/api/inventory/movements/%s/note.pdf' % rec['id'], role='MECHANIC'))['pdf']
    assert ok(api('GET', '/api/inventory/products', role='MECHANIC'))
    assert ok(api('GET', '/api/workshop/export'))['invoices']


def test_fully_refunded_bill_is_not_owing_and_overdue_counts(api):
    p, inv = invoiced(api, 3, 'CAB-7777')
    ok(api('POST', '/api/workshop/invoices/%s/payments' % inv['id'], {'amount': 5400, 'method': 'CASH'}, role='MECHANIC'))
    done = ok(api('POST', '/api/workshop/invoices/%s/refund' % inv['id'], {'amount': 5400, 'method': 'CASH', 'reason': 'Customer cancelled'}))
    assert done['status'] == 'REFUNDED' and done['paid'] == 0
    assert ok(api('GET', '/api/workshop/owing', query={'reg': 'CAB-7777'})) == []
    dash = ok(api('GET', '/api/workshop/dashboard'))
    assert dash['unpaid_count'] == 0 and dash['overdue_count'] == 0 and dash['terms_days'] == 14
    visit = ok(api('GET', '/api/workshop/vehicles/CAB-7777'))['history'][0]
    assert visit['pay_status'] == 'REFUNDED' and visit['balance'] == 0
    # money taken again: part paid, owing again
    again = ok(api('POST', '/api/workshop/invoices/%s/payments' % inv['id'], {'amount': 1000, 'method': 'CASH'}, role='MECHANIC'))
    assert again['status'] == 'PARTIAL' and len(ok(api('GET', '/api/workshop/owing', query={'reg': 'CAB-7777'}))) == 1


def age_bill(inv_id, days, invoice_type=None):
    """Make a bill look `days` old (and optionally change its type) the way real older data would."""
    from stocklane_api import core
    at = (today() - timedelta(days=days)).isoformat() + 'T06:00:00+00:00'
    expr, vals = 'SET created_at = :a', {':a': at}
    if invoice_type:
        expr, vals = 'SET created_at = :a, invoice_type = :t', {':a': at, ':t': invoice_type}
    core.transact([core.update('WINV', inv_id, expr, vals)], [None])


def test_insurance_and_credit_bills_are_not_overdue_at_the_cash_deadline(api):
    p, inv = invoiced(api, 3, 'CAB-5001')            # BIZ terms are 14 days
    age_bill(inv['id'], 20, 'CASH')
    row = [i for i in ok(api('GET', '/api/workshop/invoices')) if i['id'] == inv['id']][0]
    assert row['due_days'] == 14 and row['overdue_days'] >= 5
    assert ok(api('GET', '/api/workshop/dashboard'))['overdue_count'] == 1
    age_bill(inv['id'], 20, 'INSURANCE')             # an insurer is given 30 days
    row = [i for i in ok(api('GET', '/api/workshop/invoices')) if i['id'] == inv['id']][0]
    assert row['due_days'] == 30 and row['overdue_days'] == 0
    assert ok(api('GET', '/api/workshop/dashboard'))['overdue_count'] == 0
    assert ok(api('GET', '/api/workshop/owing', query={'reg': 'CAB-5001'}))[0]['overdue_days'] == 0
    age_bill(inv['id'], 35, 'CREDIT')
    one = ok(api('GET', '/api/workshop/invoices/%s' % inv['id']))
    assert one['due_days'] == 30 and one['overdue_days'] >= 5
    assert ok(api('GET', '/api/workshop/dashboard'))['overdue_count'] == 1


def test_old_refunded_bill_saved_as_unpaid_reads_as_refunded(api):
    from stocklane_api import core
    p, inv = invoiced(api, 3, 'CAB-5002')
    ok(api('POST', '/api/workshop/invoices/%s/payments' % inv['id'], {'amount': 5400, 'method': 'CASH'}, role='MECHANIC'))
    ok(api('POST', '/api/workshop/invoices/%s/refund' % inv['id'], {'amount': 5400, 'method': 'CASH', 'reason': 'Cancelled'}))
    core.transact([core.update('WINV', inv['id'], 'SET #s = :u', {':u': 'UNPAID'}, names={'#s': 'status'})], [None])   # how it was stored before REFUNDED existed
    assert ok(api('GET', '/api/workshop/invoices/%s' % inv['id']))['status'] == 'REFUNDED'
    assert [i['status'] for i in ok(api('GET', '/api/workshop/invoices')) if i['id'] == inv['id']] == ['REFUNDED']
    assert ok(api('GET', '/api/workshop/owing', query={'reg': 'CAB-5002'})) == []
    dash = ok(api('GET', '/api/workshop/dashboard'))
    assert dash['unpaid_count'] == 0 and dash['overdue_count'] == 0
    assert ok(api('GET', '/api/workshop/vehicles/CAB-5002'))['history'][0]['pay_status'] == 'REFUNDED'


def test_part_lines_remember_part_no_and_the_day_they_were_added(api):
    """The job card's parts sheet prints Date and Part No: both are kept on the line and survive later saves."""
    ok(api('PUT', '/api/workshop/settings', BIZ))
    p, job = product(api, 10), new_job(api, 'CAB-6001')
    j = ok(use(api, job, p['id'], 2))
    line = j['parts'][0]
    assert line['added_at'] == today().isoformat() and line['part_no']
    # a later save (client sends only name, qty, price, product_id) keeps both and stamps a new free-text line
    body = [{'name': line['name'], 'quantity': 2, 'unit_price': line['unit_price'], 'product_id': line['product_id']}, {'name': 'Gasket', 'quantity': 1, 'unit_price': 500}]
    saved = ok(api('PATCH', '/api/workshop/jobs/%s' % job['id'], {'revision': j['revision'], 'parts': body}, role='MECHANIC'))
    assert saved['parts'][0]['part_no'] == line['part_no'] and saved['parts'][0]['added_at'] == line['added_at']
    assert saved['parts'][1]['added_at'] == today().isoformat() and 'part_no' not in saved['parts'][1]


def test_bill_shows_part_number_even_for_older_lines(api):
    from stocklane_api import core
    p, inv = invoiced(api, 2, 'CAB-6002')
    one = ok(api('GET', '/api/workshop/invoices/%s' % inv['id']))
    assert one['parts'][0]['part_no']
    # a line saved before part numbers were kept still gets one from the parts list
    core.transact([core.update('WINV', inv['id'], 'SET parts[0] = :l', {':l': {k: v for k, v in inv['parts'][0].items() if k not in ('part_no', 'added_at')}})], [None])
    again = ok(api('GET', '/api/workshop/invoices/%s' % inv['id']))
    assert again['parts'][0]['part_no'] == one['parts'][0]['part_no']
    assert ok(api('GET', '/api/workshop/invoices/%s/pdf' % inv['id'], role='MECHANIC'))['pdf']


def test_job_shows_parts_that_came_back_after_the_bill(api):
    p, inv = invoiced(api, 3, 'CAB-6200')
    job = ok(api('GET', '/api/workshop/jobs/%s' % inv['job_id']))
    assert 'returned' not in job['parts'][0]
    ok(api('POST', '/api/workshop/invoices/%s/return' % inv['id'], {'lines': [{'index': 0, 'quantity': 1}], 'reason': 'Wrong part'}))
    job = ok(api('GET', '/api/workshop/jobs/%s' % inv['job_id']))
    assert job['parts'][0]['returned'] == 1 and job['parts'][0]['returned_at'] == today().isoformat() and job['parts'][0]['quantity'] == 3


def test_void_after_parts_came_back_does_not_return_them_to_stock_twice(api):
    """3 used, 1 came back after the bill (stock 8), bill voided, job cancelled: the job must give back only the 2 it still holds (stock 10, not 11)."""
    p, inv = invoiced(api, 3, 'CAB-6300')
    assert stock(api, p['id']) == 7
    ok(api('POST', '/api/workshop/invoices/%s/return' % inv['id'], {'lines': [{'index': 0, 'quantity': 1}], 'reason': 'Wrong part'}))
    assert stock(api, p['id']) == 8
    ok(api('POST', '/api/workshop/invoices/%s/void' % inv['id'], {'reason': 'Wrong car'}))
    job = ok(api('GET', '/api/workshop/jobs/%s' % inv['job_id']))
    assert job['status'] == 'OPEN' and job['parts'][0]['quantity'] == 2 and 'returned' not in job['parts'][0]
    ok(api('POST', '/api/workshop/jobs/%s/cancel' % inv['job_id'], {'revision': job['revision']}))
    assert stock(api, p['id']) == 10


def test_all_parts_returned_and_refunded_makes_a_refunded_bill_not_a_zero_paid_bill(api):
    from stocklane_api import core
    p, inv = invoiced(api, 3, 'CAB-6001')
    ok(api('POST', '/api/workshop/invoices/%s/payments' % inv['id'], {'amount': inv['total'], 'method': 'CASH'}, role='MECHANIC'))
    done = ok(api('POST', '/api/workshop/invoices/%s/return' % inv['id'], {'lines': [{'index': 0, 'quantity': 3}], 'reason': 'Wrong part', 'refundMethod': 'CASH'}))
    one = ok(api('GET', '/api/workshop/invoices/%s' % inv['id']))
    assert one['total'] == 0 and one['paid'] == 0 and one['status'] == 'REFUNDED'
    assert [i['status'] for i in ok(api('GET', '/api/workshop/invoices')) if i['id'] == inv['id']] == ['REFUNDED']
    assert ok(api('GET', '/api/workshop/vehicles/CAB-6001'))['history'][0]['pay_status'] == 'REFUNDED'
    import base64
    pdf = base64.b64decode(ok(api('GET', '/api/workshop/invoices/%s/pdf' % inv['id'], role='MECHANIC'))['pdf'])
    assert pdf.startswith(b'%PDF') and b'Refunded' in pdf  # the bill PDF is made for a refunded bill (and says Refunded)
    # a bill saved as PAID with 0.00 before this fix reads as REFUNDED too
    core.transact([core.update('WINV', inv['id'], 'SET #s = :s', {':s': 'PAID'}, names={'#s': 'status'})], [None])
    assert ok(api('GET', '/api/workshop/invoices/%s' % inv['id']))['status'] == 'REFUNDED'


def test_stock_movements_point_back_to_the_job_and_bill(api):
    p, inv = invoiced(api, 3, 'CAB-6101')
    ok(api('POST', '/api/workshop/invoices/%s/return' % inv['id'], {'lines': [{'index': 0, 'quantity': 1}], 'reason': 'Wrong part', 'refundMethod': 'CASH'}))
    rows = [m for m in ok(api('GET', '/api/inventory/movements', role='MECHANIC')) if m['product_id'] == p['id']]
    back = [m for m in rows if m['kind'] == 'RETURN'][0]
    used = [m for m in rows if m['kind'] == 'ISSUE'][0]
    assert inv['invoice_number'] in back['reference'] and 'CAB-6101' in back['reference'] and 'JOB-' in back['reference']
    assert 'JOB-' in used['reference'] and 'CAB-6101' in used['reference']


def test_void_a_bill_then_use_and_take_back_parts_keeps_stock_exact(api):
    p, inv = invoiced(api, 3, 'CAB-6201')            # 10 in stock, 3 on the bill -> 7
    assert stock(api, p['id']) == 7
    ok(api('POST', '/api/workshop/invoices/%s/void' % inv['id'], {'reason': 'Wrong car'}))
    assert stock(api, p['id']) == 7                  # voiding only reopens the job: the 3 parts are still on it
    job = ok(api('GET', '/api/workshop/jobs/%s' % inv['job_id']))
    assert job['status'] == 'OPEN' and job['parts'][0]['quantity'] == 3
    assert job['voids'][-1]['invoice_number'] == inv['invoice_number']   # the job itself says its bill was voided
    job = ok(use(api, job, p['id'], 2))              # two more
    assert stock(api, p['id']) == 5 and job['parts'][0]['quantity'] == 5
    job = ok(use(api, job, p['id'], 4, 'return'))    # four back
    assert stock(api, p['id']) == 9 and job['parts'][0]['quantity'] == 1
    ok(api('POST', '/api/workshop/jobs/%s/cancel' % job['id'], {'revision': job['revision']}))
    assert stock(api, p['id']) == 10                 # cancelling gives the last one back: nothing lost, nothing twice


def test_sales_report_counts_only_what_the_customer_kept(api):
    from test_job_stock import new_job, use
    p, inv = invoiced(api, 4, 'CAB-7001')
    ok(api('POST', '/api/workshop/invoices/%s/payments' % inv['id'], {'amount': inv['total'], 'method': 'CASH'}, role='MECHANIC'))
    ok(api('POST', '/api/workshop/invoices/%s/return' % inv['id'], {'lines': [{'index': 0, 'quantity': 1}], 'reason': 'x', 'refundMethod': 'CASH'}))   # 3 kept
    j = ok(use(api, new_job(api, 'CAB-7002'), p['id'], 2))
    inv2 = ok(api('POST', '/api/workshop/jobs/%s/invoice' % j['id'], {'revision': j['revision']}, role='MECHANIC'))
    ok(api('POST', '/api/workshop/invoices/%s/payments' % inv2['id'], {'amount': inv2['total'], 'method': 'CASH'}, role='MECHANIC'))
    ok(api('POST', '/api/workshop/invoices/%s/return' % inv2['id'], {'lines': [{'index': 0, 'quantity': 2}], 'reason': 'x', 'refundMethod': 'CASH'}))  # all back
    r = ok(api('GET', '/api/workshop/report', role='OWNER'))
    one = ok(api('GET', '/api/workshop/invoices/%s' % inv['id']))
    assert r['invoices'] == 1 and r['vehicles'] == 1                      # the fully refunded bill is no sale
    assert r['total'] == one['total'] == r['parts_total'] + r['labour_total'] - r['discount'] + r['tax']
    assert r['top_parts'][0]['quantity'] == 3 and r['top_parts'][0]['amount'] == r['parts_total']
    assert r['average'] == r['total']
    assert r['received'] == r['total']                                    # cash kept = what was sold, refunds taken off


def test_job_lists_returns_for_the_printed_status_block(api):
    p, inv = invoiced(api, 3, 'CAB-6210')
    assert ok(api('GET', '/api/workshop/jobs/%s' % inv['job_id']))['returns'] == []
    ok(api('POST', '/api/workshop/invoices/%s/return' % inv['id'], {'lines': [{'index': 0, 'quantity': 2}], 'reason': 'Wrong part'}))
    job = ok(api('GET', '/api/workshop/jobs/%s' % inv['job_id']))
    assert len(job['returns']) == 1 and job['returns'][0]['reason'] == 'Wrong part' and float(job['returns'][0]['quantity']) == 2
    assert job['out_at'] and job['status'] == 'INVOICED'


def other_product(api, qty=10):
    from test_job_stock import ok as _ok
    return _ok(api('POST', '/api/inventory/products', {'partNumber': 'PN-2', 'sku': 'AF-2', 'name': 'Air filter', 'category': 'Filters', 'brand': 'Toyota', 'unit': 'UNIT',
                                                       'sellingPrice': 900, 'reorderLevel': 3, 'openingQuantity': qty, 'location': 'A4'}))


def test_notes_are_numbered_in_a_running_series(api):
    from test_stock_count import product
    p = product(api, 5)
    a = ok(api('POST', '/api/inventory/movements', {'kind': 'RECEIPT', 'productId': p['id'], 'quantity': 1}, role='MECHANIC'))
    b = ok(api('POST', '/api/inventory/movements', {'kind': 'RECEIPT', 'productId': p['id'], 'quantity': 1}, role='MECHANIC'))
    g = ok(api('POST', '/api/inventory/movements', {'kind': 'STOCK_OUT', 'productId': p['id'], 'quantity': 1}, role='MECHANIC'))
    n = lambda x: int(x['doc_no'].split('-')[1])
    assert a['doc_no'].startswith('GRN-') and n(b) == n(a) + 1 and g['doc_no'].startswith('GIN-') and n(g) >= 1
    # an undo takes no number
    undo = ok(api('POST', '/api/inventory/movements', {'kind': 'STOCK_OUT', 'productId': p['id'], 'quantity': 1, 'note': 'Undo of a counter entry'}, role='MECHANIC'))
    again = ok(api('POST', '/api/inventory/movements', {'kind': 'RECEIPT', 'productId': p['id'], 'quantity': 1}, role='MECHANIC'))
    assert 'doc_no' not in undo and n(again) == n(b) + 1


def test_delivery_note_with_several_parts_is_one_number_and_one_pdf(api):
    from test_stock_count import product, stock
    p1, p2 = product(api, 5), other_product(api, 2)
    body = {'kind': 'RECEIPT', 'supplier': 'Lanka Spares', 'reference': 'INV-9001',
            'lines': [{'productId': p1['id'], 'quantity': 4, 'unitCost': '1200'}, {'productId': p2['id'], 'quantity': 6}]}
    doc = ok(api('POST', '/api/inventory/documents', body, role='MECHANIC'))
    assert doc['doc_no'].startswith('GRN-') and len(doc['lines']) == 2 and doc['supplier'] == 'Lanka Spares'
    assert all('unit_cost' not in l for l in doc['lines'])  # a mechanic never reads the price back
    assert stock(api, p1['id']) == 9 and stock(api, p2['id']) == 8
    moves = [m for m in ok(api('GET', '/api/inventory/movements')) if m.get('doc_no') == doc['doc_no']]
    assert len(moves) == 2 and {m['reference'] for m in moves} == {'INV-9001'} and {m['supplier'] for m in moves} == {'Lanka Spares'}
    assert [m for m in moves if m['product_id'] == p1['id']][0]['unit_cost'] == 1200
    # the same note prints from any of its lines, listing every part
    for m in moves:
        assert ok(api('GET', '/api/inventory/movements/%s/note.pdf' % m['id'], role='MECHANIC'))['pdf']
    assert ok(api('GET', '/api/inventory/movements/%s/note.pdf' % moves[0]['id'], query={'cost': '1'}))['pdf']
    nxt = ok(api('POST', '/api/inventory/documents', {'kind': 'RECEIPT', 'lines': [{'productId': p1['id'], 'quantity': 1}]}, role='MECHANIC'))
    assert int(nxt['doc_no'].split('-')[1]) == int(doc['doc_no'].split('-')[1]) + 1
    # the owner sees the cost on the saved note
    assert ok(api('GET', '/api/inventory/movements/%s/note.pdf' % moves[0]['id'], query={'cost': '1'}))['pdf']


def test_goods_issue_note_with_several_parts_and_nothing_half_saved(api):
    from test_stock_count import product, stock
    p1, p2 = product(api, 5), other_product(api, 1)
    # the second part is short: nothing at all is taken
    code, _ = api('POST', '/api/inventory/documents', {'kind': 'STOCK_OUT', 'lines': [{'productId': p1['id'], 'quantity': 2}, {'productId': p2['id'], 'quantity': 3}]}, role='MECHANIC')[:2]
    assert code == 409 and stock(api, p1['id']) == 5 and stock(api, p2['id']) == 1
    doc = ok(api('POST', '/api/inventory/documents', {'kind': 'STOCK_OUT', 'lines': [{'productId': p1['id'], 'quantity': 2}, {'productId': p2['id'], 'quantity': 1}]}, role='MECHANIC'))
    assert doc['doc_no'].startswith('GIN-') and stock(api, p1['id']) == 3 and stock(api, p2['id']) == 0
    # rules: lines needed, no part twice, not more than a transaction can hold
    assert api('POST', '/api/inventory/documents', {'kind': 'RECEIPT', 'lines': []}, role='MECHANIC')[0] == 400
    assert api('POST', '/api/inventory/documents', {'kind': 'RECEIPT', 'lines': [{'productId': p1['id'], 'quantity': 1}, {'productId': p1['id'], 'quantity': 1}]}, role='MECHANIC')[0] == 400
    assert api('POST', '/api/inventory/documents', {'kind': 'RECEIPT', 'lines': [{'productId': p1['id'], 'quantity': 1}] * 16}, role='MECHANIC')[0] == 400
    assert api('POST', '/api/inventory/documents', {'kind': 'ISSUE', 'lines': [{'productId': p1['id'], 'quantity': 1}]}, role='MECHANIC')[0] == 400


def test_part_bought_outside_keeps_its_cost_for_the_owner_only(api):
    from test_job_stock import new_job
    ok(api('PUT', '/api/workshop/settings', BIZ))
    job = new_job(api, 'CAB-7777')
    line = {'name': 'Wiper blade', 'quantity': 2, 'unit_price': 1500, 'outside': True, 'outside_cost': '900', 'outside_shop': 'Fort Auto'}
    # the mechanic buys it and types the price, but never reads it back
    j = ok(api('PATCH', '/api/workshop/jobs/%s' % job['id'], {'revision': job['revision'], 'parts': [line]}, role='MECHANIC'))
    assert j['parts'][0]['outside'] is True and 'outside_cost' not in j['parts'][0] and 'outside_shop' not in j['parts'][0]
    own = ok(api('GET', '/api/workshop/jobs/%s' % job['id']))
    assert own['parts'][0]['outside_cost'] == 900 and own['parts'][0]['outside_shop'] == 'Fort Auto'
    # the mechanic saves the job again (the cost is hidden from them, so it is not sent): the stored cost stays
    again = ok(api('PATCH', '/api/workshop/jobs/%s' % job['id'], {'revision': j['revision'], 'parts': [{'name': 'Wiper blade', 'quantity': 3, 'unit_price': 1500, 'outside': True}]}, role='MECHANIC'))
    assert 'outside_cost' not in again['parts'][0]
    # the mechanic names the shop later: only the shop changes, the cost stays
    shopped = ok(api('PATCH', '/api/workshop/jobs/%s' % job['id'], {'revision': again['revision'], 'parts': [{'name': 'Wiper blade', 'quantity': 3, 'unit_price': 1500, 'outside': True, 'outside_shop': 'Pettah Spares'}]}, role='MECHANIC'))
    assert ok(api('GET', '/api/workshop/jobs/%s' % job['id']))['parts'][0]['outside_shop'] == 'Pettah Spares'
    ok(api('PATCH', '/api/workshop/jobs/%s' % job['id'], {'revision': shopped['revision'], 'parts': [{'name': 'Wiper blade', 'quantity': 3, 'unit_price': 1500, 'outside': True, 'outside_shop': 'Fort Auto'}]}, role='MECHANIC'))
    kept = ok(api('GET', '/api/workshop/jobs/%s' % job['id']))
    assert kept['parts'][0]['quantity'] == 3 and kept['parts'][0]['outside_cost'] == 900
    # the owner can correct it, or clear it
    fixed = ok(api('PATCH', '/api/workshop/jobs/%s' % job['id'], {'revision': kept['revision'], 'parts': [dict(line, quantity=3, outside_cost='950')]}))
    assert fixed['parts'][0]['outside_cost'] == 950
    cleared = ok(api('PATCH', '/api/workshop/jobs/%s' % job['id'], {'revision': fixed['revision'], 'parts': [dict(line, quantity=3, outside_cost='')]}))
    assert 'outside_cost' not in cleared['parts'][0]
    # a stock line cannot be an outside line, and a negative cost is refused
    assert api('PATCH', '/api/workshop/jobs/%s' % job['id'], {'revision': cleared['revision'], 'parts': [dict(line, outside_cost='-5')]})[0] == 400
    # the bill carries the cost for the owner's report, but the customer's copy and a mechanic never see it
    again = ok(api('PATCH', '/api/workshop/jobs/%s' % job['id'], {'revision': cleared['revision'], 'parts': [dict(line, quantity=3, outside_cost='950')]}))
    inv = ok(api('POST', '/api/workshop/jobs/%s/invoice' % job['id'], {'revision': again['revision']}, role='MECHANIC'))
    assert 'outside_cost' not in inv['parts'][0] and inv['parts'][0]['outside'] is True
    assert ok(api('GET', '/api/workshop/invoices/%s' % inv['id']))['parts'][0]['outside_cost'] == 950
    assert 'outside_cost' not in ok(api('GET', '/api/workshop/invoices/%s' % inv['id'], role='MECHANIC'))['parts'][0]
    assert ok(api('GET', '/api/workshop/invoices/%s/pdf' % inv['id'], role='MECHANIC'))['pdf']
    # the owner's report: what was spent outside, with whom, and what was left
    rep = ok(api('GET', '/api/workshop/report'))
    out = rep['outside']
    assert out['lines'] == 1 and out['cost'] == 2850 and out['sales'] == 4500 and out['margin'] == 1650 and out['without_cost'] == 0
    assert out['by_shop'][0]['shop'] == 'Fort Auto' and out['by_shop'][0]['cost'] == 2850
    assert api('GET', '/api/workshop/report', role='MECHANIC')[0] == 403


def test_label_sheet_pdf(api):
    bits = '21:' + '10' * 220 + '1'
    assert len(bits) == 3 + 441
    pdf = ok(api('POST', '/api/inventory/labels/pdf', {'labels': [{'title': 'Rack 1-A', 'sub': 'Left wall', 'bits': bits}] * 20}, role='MECHANIC'))['pdf']
    assert pdf
    assert api('POST', '/api/inventory/labels/pdf', {'labels': []})[0] == 400
    assert api('POST', '/api/inventory/labels/pdf', {'labels': [{'title': 'x', 'bits': 'nope'}]})[0] == 400
