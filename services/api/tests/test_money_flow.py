"""The money path end to end: settings -> job -> bill -> payment -> void -> archive -> restore, plus the report and PDFs."""
import base64
import json
from datetime import date, timedelta

BIZ = {'name': 'Ganga Motors', 'address': 'Anuradhapura', 'phone': '025 222 3344', 'email': '', 'reg_no': '', 'bank': 'BOC 1234567', 'footer': 'Thank you',
       'tax_name': 'VAT', 'tax_rate': 0, 'mechanic_discount_pct': 10, 'payment_terms_days': 14, 'warranty': 'Parts 30 days', 'qr_url': ''}


def ok(res):
    status, body = res
    assert status == 200, body
    return body


def new_job(api, reg='CAB-1234', **extra):
    return ok(api('POST', '/api/workshop/jobs', {'registration': reg, 'customer': 'Nimal Perera', 'phone': '0771234567', 'vehicle': 'Toyota Prius',
                                                 'odometer': 85200, 'summary': 'Oil change', **extra}, role='MECHANIC', who='kasun'))


def fill(api, job_id, discount=0, role='OWNER', rev=0):
    return api('PATCH', '/api/workshop/jobs/' + job_id, {'parts': [{'name': 'Oil filter', 'quantity': 2, 'unit_price': 1800}], 'labour': [{'description': 'Labour', 'amount': 2500}],
                                                       'discount': discount, 'revision': rev, 'next_service_date': '2027-02-14', 'next_service_km': 90200}, role=role)


def test_full_money_flow(api):
    ok(api('PUT', '/api/workshop/settings', BIZ))
    job = new_job(api)
    assert job['status'] == 'OPEN' and job['registration'] == 'CAB-1234'
    saved = ok(fill(api, job['id'], discount=610))
    assert saved['parts_total'] == 3600 and saved['labour_total'] == 2500 and saved['total'] == 5490

    inv = ok(api('POST', '/api/workshop/jobs/%s/invoice' % job['id'], {'revision': 1}, role='MECHANIC'))
    assert inv['status'] == 'UNPAID' and inv['total'] == 5490 and inv['business']['payment_terms_days'] == 14
    # the bill keeps the shop details it was issued with
    ok(api('PUT', '/api/workshop/settings', {**BIZ, 'name': 'Renamed Shop'}))
    assert ok(api('GET', '/api/workshop/invoices/' + inv['id'], role='MECHANIC'))['business']['name'] == 'Ganga Motors'

    # partial then full payment
    part = ok(api('POST', '/api/workshop/invoices/%s/payments' % inv['id'], {'amount': 2000, 'method': 'CASH'}, role='MECHANIC'))
    assert part['status'] == 'PARTIAL' and part['paid'] == 2000
    paid = ok(api('POST', '/api/workshop/invoices/%s/payments' % inv['id'], {'amount': 3490, 'method': 'CARD'}, role='MECHANIC'))
    assert paid['status'] == 'PAID'
    status, _ = api('POST', '/api/workshop/invoices/%s/payments' % inv['id'], {'amount': 1, 'method': 'CASH'}, role='MECHANIC')
    assert status in (400, 409)  # nothing left to pay
    status, _ = api('POST', '/api/workshop/invoices/%s/void' % inv['id'], {}, role='OWNER')
    assert status in (400, 409)  # a bill with payments cannot be voided

    rows = ok(api('GET', '/api/workshop/invoices', role='MECHANIC'))
    assert [r['status'] for r in rows] == ['PAID'] and 'parts' not in rows[0]
    report = ok(api('GET', '/api/workshop/report', query={'from': (date.today() - timedelta(days=30)).isoformat(), 'until': (date.today() + timedelta(days=1)).isoformat()}))
    assert json.dumps(report).find('5490') >= 0
    dash = ok(api('GET', '/api/workshop/dashboard', role='MECHANIC'))
    assert dash['open_count'] == 0


def test_void_unpaid_bill_reopens_job(api):
    ok(api('PUT', '/api/workshop/settings', BIZ))
    job = new_job(api)
    ok(fill(api, job['id']))
    inv = ok(api('POST', '/api/workshop/jobs/%s/invoice' % job['id'], {'revision': 1}, role='MECHANIC'))
    ok(api('POST', '/api/workshop/invoices/%s/void' % inv['id'], {}))
    assert ok(api('GET', '/api/workshop/invoices/' + inv['id'], role='MECHANIC'))['status'] == 'VOID'
    assert ok(api('GET', '/api/workshop/jobs/' + job['id'], role='MECHANIC'))['status'] == 'OPEN'


def test_mechanic_discount_limit_and_roles(api):
    ok(api('PUT', '/api/workshop/settings', BIZ))
    job = new_job(api)
    # subtotal 6100: 10% limit is 610
    assert fill(api, job['id'], discount=700, role='MECHANIC')[0] == 400
    assert fill(api, job['id'], discount=610, role='MECHANIC')[0] == 200
    assert api('PUT', '/api/workshop/settings', BIZ, role='MECHANIC')[0] == 403
    assert api('POST', '/api/workshop/jobs/%s/archive' % job['id'], {'reason': 'x'}, role='MECHANIC')[0] == 403


def test_archive_and_restore(api):
    job = new_job(api)
    ok(api('POST', '/api/workshop/jobs/%s/archive' % job['id'], {'reason': 'Entered by mistake'}))
    assert ok(api('GET', '/api/workshop/jobs', role='MECHANIC')) == []
    assert len(ok(api('GET', '/api/workshop/archive'))['jobs']) == 1
    ok(api('POST', '/api/workshop/jobs/%s/restore' % job['id'], {'reason': 'Needed after all'}))
    assert len(ok(api('GET', '/api/workshop/jobs', role='MECHANIC'))) == 1


def test_idempotent_create(api):
    from stocklane_api import handler
    body = {'registration': 'CAB-9', 'customer': 'A', 'phone': '', 'vehicle': '', 'summary': ''}
    event = {'requestContext': {'http': {'method': 'POST'}, 'authorizer': {'jwt': {'claims': {'cognito:groups': 'MECHANIC', 'username': 'u'}}}}, 'rawPath': '/api/workshop/jobs',
             'headers': {'idempotency-key': 'same-key-0123456789'}, 'body': json.dumps(body)}
    a, b = handler.handler(event), handler.handler(event)
    assert a['body'] == b['body']
    assert len(ok(api('GET', '/api/workshop/jobs', role='MECHANIC'))) == 1


def test_cover_photo_falls_back_to_condition_photo(api):
    first, second = 'a' * 32, 'b' * 32
    job = new_job(api, before_photos=[first, second])
    assert ok(api('GET', '/api/workshop/jobs', role='MECHANIC'))[0]['front_photo'] == first
    assert ok(api('GET', '/api/workshop/vehicles', role='MECHANIC', query={'search': ''}))[0]['front_photo'] == first
    ok(api('POST', '/api/workshop/jobs/%s/photos' % job['id'], {'front_photo': 'c' * 32}, role='MECHANIC'))
    assert ok(api('GET', '/api/workshop/jobs', role='MECHANIC'))[0]['front_photo'] == 'c' * 32  # a real front photo wins


def test_bill_pdf_has_qr_and_tax_line_rule(api):
    bits = '21:' + '10' * 220 + '1'  # 441 characters = 21 * 21
    assert len(bits.split(':')[1]) == 441
    ok(api('PUT', '/api/workshop/settings', {**BIZ, 'qr_url': 'https://g.page/r/x', 'qr_bits': bits}))
    assert api('PUT', '/api/workshop/settings', {**BIZ, 'qr_url': 'https://g.page/r/x', 'qr_bits': '21:101'})[0] == 400
    job = new_job(api)
    ok(fill(api, job['id']))
    inv = ok(api('POST', '/api/workshop/jobs/%s/invoice' % job['id'], {'revision': 1}, role='MECHANIC'))
    pdf = base64.b64decode(ok(api('GET', '/api/workshop/invoices/%s/pdf' % inv['id'], role='MECHANIC'))['pdf'])
    assert pdf.startswith(b'%PDF') and b'not a tax invoice' in pdf and b'HOW TO PAY' in pdf and b'WARRANTY' in pdf
    # a registered shop never prints "not a tax invoice"
    ok(api('PUT', '/api/workshop/settings', {**BIZ, 'reg_no': 'VAT 123456789'}))
    job2 = new_job(api, reg='CAB-7777')
    ok(fill(api, job2['id']))
    inv2 = ok(api('POST', '/api/workshop/jobs/%s/invoice' % job2['id'], {'revision': 1}, role='MECHANIC'))
    pdf2 = base64.b64decode(ok(api('GET', '/api/workshop/invoices/%s/pdf' % inv2['id'], role='MECHANIC'))['pdf'])
    assert b'not a tax invoice' not in pdf2
