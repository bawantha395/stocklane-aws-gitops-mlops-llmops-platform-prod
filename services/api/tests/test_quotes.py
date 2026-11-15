"""Quotations: sections and totals, TBC parts, revisions, owner-only status, convert to job, and that nothing else is touched."""
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
    assert q['number'].startswith('QT-') and q['status'] == 'DRAFT' and q['rev_no'] == 1
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


def test_empty_quotation_cannot_be_sent_and_jobs_untouched(api):
    q = ok(api('POST', '/api/workshop/quotes', {'registration': 'CAB-2000'}))
    assert api('POST', '/api/workshop/quotes/%s/status' % q['id'], {'revision': q['revision'], 'status': 'SENT'})[0] == 400
    assert ok(api('GET', '/api/workshop/jobs')) == [] and ok(api('GET', '/api/workshop/invoices')) == []
