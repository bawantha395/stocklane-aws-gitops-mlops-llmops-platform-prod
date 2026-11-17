"""Estimates: sections and totals, TBC parts, revisions, owner-only status, convert to job, and that nothing else is touched."""
from clock import today
from test_money_flow import ok

BASE = {'registration': 'cab-1000', 'insurer': 'Allianz Motor Insurance Lanka Limited', 'insurer_branch': 'Anuradhapura', 'claim_no': 'CL-77',
        'vehicle': 'Toyota Aqua', 'issue': 'Front bumper and body kit damaged',
        'labour': [{'description': 'FR Shell', 'amount': 800, 'section': 'Rem/Refit'}, {'description': 'FR Head Lamp both side', 'amount': 1800, 'section': 'Rem/Refit'},
                   {'description': 'FR Bumper', 'amount': 14500, 'section': 'Repaint'}, {'description': 'FR Body Kit', 'amount': 9000, 'section': 'Repaint'}],
        'parts': [{'name': 'FR Body Kit', 'quantity': 1, 'unit_price': 0}, {'name': 'Clips', 'quantity': 1, 'unit_price': 0}]}


def make(api, role='MECHANIC', **extra):
    return ok(api('POST', '/api/workshop/quotes', {**BASE, **extra}, role=role))


def test_sections_totals_and_unpriced_parts(api):
    q = make(api)
    assert q['number'].startswith('EST-') and q['status'] == 'DRAFT' and q['rev_no'] == 1
    assert q['sections'] == {'Rem/Refit': 2600, 'Repaint': 23500, 'Other': 0}
    assert q['labour_total'] == 26100 and q['parts_total'] == 0 and q['total'] == 26100 and q['parts_unpriced'] == 2
    q = ok(api('PATCH', '/api/workshop/quotes/' + q['id'], {'revision': q['revision'], 'parts': [
        {'name': 'FR Body Kit', 'quantity': 1, 'unit_price': 46000}, {'name': 'Clips', 'quantity': 1, 'unit_price': 800}, {'name': 'Body Sealant Gum', 'quantity': 1, 'unit_price': 4750}]}))
    assert q['parts_total'] == 51550 and q['total'] == 77650 and q['parts_unpriced'] == 0


def test_checks(api):
    assert api('POST', '/api/workshop/quotes', {**BASE, 'registration': ''})[0] == 400
    assert api('POST', '/api/workshop/quotes', {**BASE, 'labour': [{'description': 'X', 'amount': 5, 'section': 'Magic'}]})[0] == 400
    assert api('POST', '/api/workshop/quotes', {**BASE, 'labour': [{'description': 'X', 'amount': -5, 'section': 'Other'}]})[0] == 400
    assert api('POST', '/api/workshop/quotes', {**BASE, 'insurer': 'සිං'})[0] == 400
    assert api('POST', '/api/workshop/quotes', {**BASE, 'valid_until': 'soon'})[0] == 400
    q = make(api)
    assert api('PATCH', '/api/workshop/quotes/' + q['id'], {'revision': 99, 'issue': 'x'})[0] == 409  # stale revision


def test_revise_keeps_the_earlier_version(api):
    q = make(api)
    r = ok(api('POST', '/api/workshop/quotes/%s/revise' % q['id'], {'revision': q['revision'], 'note': 'Parts priced'}))
    assert r['rev_no'] == 2 and len(r['history']) == 1 and r['history'][0]['rev_no'] == 1 and r['history'][0]['total'] == 26100
    assert r['total'] == 26100 and r['status'] == 'DRAFT'
    r = ok(api('PATCH', '/api/workshop/quotes/' + q['id'], {'revision': r['revision'], 'parts': [{'name': 'Clips', 'quantity': 1, 'unit_price': 800}]}))
    assert r['total'] == 26900 and r['history'][0]['total'] == 26100  # v1 is untouched by edits to v2


def test_status_is_owner_only_and_convert_makes_a_job(api):
    q = make(api, customer='Nimal Perera', phone='0771234567', photos=[])
    assert api('POST', '/api/workshop/quotes/%s/status' % q['id'], {'revision': q['revision'], 'status': 'APPROVED'}, role='MECHANIC')[0] == 403
    assert api('POST', '/api/workshop/quotes/%s/convert' % q['id'], {'revision': q['revision']})[0] == 400  # not approved yet
    q = ok(api('POST', '/api/workshop/quotes/%s/status' % q['id'], {'revision': q['revision'], 'status': 'APPROVED'}))
    done = ok(api('POST', '/api/workshop/quotes/%s/convert' % q['id'], {'revision': q['revision']}))
    job = ok(api('GET', '/api/workshop/jobs/' + done['job_id']))
    assert job['status'] == 'OPEN' and job['registration'] == 'CAB-1000' and job['customer'] == 'Nimal Perera' and job['quote_number'] == q['number']
    assert len(job['parts']) == 2 and [l['description'] for l in job['labour']][:3] == ['Rem/Refit - FR Shell', 'Rem/Refit - FR Head Lamp both side', 'Repaint - FR Bumper']
    assert job['labour_total'] == 26100
    assert ok(api('GET', '/api/workshop/quotes/' + q['id']))['status'] == 'CONVERTED'
    assert api('POST', '/api/workshop/quotes/%s/convert' % q['id'], {'revision': done['quote']['revision']})[0] == 409  # never twice
    assert api('PATCH', '/api/workshop/quotes/' + q['id'], {'revision': done['quote']['revision'], 'issue': 'x'})[0] == 409
    assert api('DELETE', '/api/workshop/quotes/' + q['id'])[0] == 409


def test_convert_needs_a_customer_and_delete_and_list(api):
    q = make(api)
    q = ok(api('POST', '/api/workshop/quotes/%s/status' % q['id'], {'revision': q['revision'], 'status': 'APPROVED'}))
    assert api('POST', '/api/workshop/quotes/%s/convert' % q['id'], {'revision': q['revision']})[0] == 400
    listing = ok(api('GET', '/api/workshop/quotes', role='MECHANIC'))
    assert len(listing) == 1 and listing[0]['total'] == 26100 and 'parts' not in listing[0]
    assert api('DELETE', '/api/workshop/quotes/' + q['id'], role='MECHANIC')[0] == 403
    ok(api('DELETE', '/api/workshop/quotes/' + q['id']))
    assert api('GET', '/api/workshop/quotes/' + q['id'])[0] == 404


def test_empty_estimate_cannot_be_sent_and_jobs_untouched(api):
    q = ok(api('POST', '/api/workshop/quotes', {'registration': 'CAB-2000'}))
    assert api('POST', '/api/workshop/quotes/%s/status' % q['id'], {'revision': q['revision'], 'status': 'SENT'})[0] == 400
    assert ok(api('GET', '/api/workshop/jobs')) == [] and ok(api('GET', '/api/workshop/invoices')) == []


def test_quotation_is_a_fixed_price_estimate_can_have_unpriced_parts(api):
    body = {'registration': 'CAB-3000', 'customer': 'Nimal', 'parts': [{'name': 'Bumper', 'quantity': 1, 'unit_price': 0}], 'labour': [{'description': 'Fit', 'amount': 1000, 'section': 'Other'}]}
    est = ok(api('POST', '/api/workshop/quotes', body))
    assert est['kind'] == 'ESTIMATE' and est['number'].startswith('EST-')
    ok(api('POST', '/api/workshop/quotes/%s/status' % est['id'], {'revision': est['revision'], 'status': 'SENT'}))  # price TBC is fine on an estimate
    quo = ok(api('POST', '/api/workshop/quotes', dict(body, kind='QUOTATION')))
    assert quo['kind'] == 'QUOTATION' and quo['number'].startswith('QUO-')
    status, res = api('POST', '/api/workshop/quotes/%s/status' % quo['id'], {'revision': quo['revision'], 'status': 'SENT'})
    assert status == 400 and 'fixed price' in str(res)
    quo = ok(api('PATCH', '/api/workshop/quotes/' + quo['id'], {'revision': quo['revision'], 'parts': [{'name': 'Bumper', 'quantity': 1, 'unit_price': 9000}]}))
    sent = ok(api('POST', '/api/workshop/quotes/%s/status' % quo['id'], {'revision': quo['revision'], 'status': 'SENT'}))
    assert sent['status'] == 'SENT' and sent['total'] == 10000
    kinds = sorted(x['kind'] for x in ok(api('GET', '/api/workshop/quotes', role='MECHANIC')))
    assert kinds == ['ESTIMATE', 'QUOTATION']


def test_quote_part_number_prints_and_carries_to_the_job(api):
    from datetime import date
    q = make(api, customer='Nimal Perera', parts=[{'name': 'Head lamp', 'quantity': 1, 'unit_price': 9000, 'part_no': 'HL-8100'}, {'name': 'Clips', 'quantity': 2, 'unit_price': 0}])
    assert q['parts'][0]['part_no'] == 'HL-8100' and 'part_no' not in q['parts'][1]
    q = ok(api('POST', '/api/workshop/quotes/%s/status' % q['id'], {'revision': q['revision'], 'status': 'APPROVED'}))
    job = ok(api('GET', '/api/workshop/jobs/' + ok(api('POST', '/api/workshop/quotes/%s/convert' % q['id'], {'revision': q['revision']}))['job_id']))
    assert job['parts'][0]['part_no'] == 'HL-8100' and job['parts'][0]['added_at'] == today().isoformat()


def test_bill_prints_job_no_type_and_chassis(api):
    import base64
    from test_returns_and_owing import invoiced
    from stocklane_api import core
    p, inv = invoiced(api, 1, 'CAB-6100')
    core.transact([core.update('WINV', inv['id'], 'SET job_no = :n, invoice_type = :t, chassis = :c', {':n': 'JOB-0042', ':t': 'INSURANCE', ':c': 'ZVW30-9988'})], [None])
    pdf = base64.b64decode(ok(api('GET', '/api/workshop/invoices/%s/pdf' % inv['id'], role='MECHANIC'))['pdf'])
    assert b'Job: JOB-0042' in pdf and b'Insurance bill' in pdf and b'Chassis: ZVW30-9988' in pdf


def test_quotation_expires_and_home_counts_it(api):
    from datetime import date, timedelta
    def mk(kind, days, status=None):
        until = (today() + timedelta(days=days)).isoformat()
        code, q = api('POST', '/api/workshop/quotes', {'registration': 'CAB-%d' % (days + 50), 'customer': 'Nimal', 'kind': kind, 'valid_until': until,
                                                      'parts': [{'name': 'Door', 'quantity': 1, 'unit_price': 5000}]})
        assert code == 200
        if status:
            code, q = api('POST', '/api/workshop/quotes/%s/status' % q['id'], {'revision': q['revision'], 'status': status})
            assert code == 200
        return q
    old = mk('QUOTATION', -2, 'SENT')
    soon = mk('QUOTATION', 2, 'SENT')
    far = mk('QUOTATION', 10, 'SENT')
    est = mk('ESTIMATE', 5, 'SENT')
    assert old['expired'] is True and soon['expired'] is False and soon['days_left'] == 2
    code, d = api('GET', '/api/workshop/dashboard')
    assert d['quotes_expiring'] == 1 and d['estimates_waiting'] == 1
    code, rows = api('GET', '/api/workshop/quotes')
    assert {r['id']: r['expired'] for r in rows}[old['id']] is True
