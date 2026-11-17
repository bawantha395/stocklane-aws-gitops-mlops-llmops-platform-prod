"""Customers: found by phone, made by a job, kept apart per shop, merged, and a statement that adds up."""
from test_money_flow import BIZ, ok
from test_shops import JOB


def job(api, **extra):
    return ok(api('POST', '/api/workshop/jobs', dict(JOB, **extra), role='MECHANIC', who='kasun'))


def bill(api, j, amount=2500):
    j = ok(api('PATCH', '/api/workshop/jobs/%s' % j['id'], {'revision': j['revision'], 'labour': [{'description': 'Service', 'amount': amount}], 'discount': 0}))
    return ok(api('POST', '/api/workshop/jobs/%s/invoice' % j['id'], {'revision': j['revision']}))


def people(api, **kw):
    return ok(api('GET', '/api/workshop/customers', **kw))


def test_phone_numbers_have_one_spelling():
    from stocklane_api.customers import canon
    assert {canon(x) for x in ('0771234567', '077 123 4567', '+94 77 123 4567', '0094771234567', '94771234567', '771234567')} == {'0771234567'}
    assert canon('12345') == '' and canon('') == ''


def test_a_job_finds_or_makes_the_customer(api):
    ok(api('PUT', '/api/workshop/settings', BIZ))
    a = job(api)
    b = job(api, registration='CAB-5555', phone='+94 77 123 4567', customer='Nimal P.')  # same person, typed another way
    c = job(api, registration='CAB-6666', phone='', customer='Walk-in man')  # no number: nobody to remember
    rows = people(api)
    assert len(rows) == 1 and rows[0]['phone'] == '0771234567' and rows[0]['vehicles'] == 2 and rows[0]['jobs'] == 2
    one = ok(api('GET', '/api/workshop/customers/%s' % rows[0]['id']))
    assert one['name'] == 'Nimal Perera' and one['names'] == ['Nimal P.'] and {v['registration'] for v in one['vehicle_list']} == {'CAB-1234', 'CAB-5555'}
    assert {t['id'] for t in one['timeline']} == {a['id'], b['id']} and c['id'] not in {t['id'] for t in one['timeline']}
    # the bill remembers who it is for, and the job still prints the name typed that day
    inv = bill(api, a)
    assert ok(api('GET', '/api/workshop/invoices/%s' % inv['id']))['customer_id'] == rows[0]['id']
    assert ok(api('GET', '/api/workshop/jobs/%s' % b['id']))['customer'] == 'Nimal P.'


def test_search_finds_by_name_number_and_vehicle(api):
    job(api)
    job(api, registration='KA-7777', phone='0712223333', customer='Sunil Silva')
    assert [r['name'] for r in people(api, query={'search': 'sunil'})] == ['Sunil Silva']
    assert [r['name'] for r in people(api, query={'search': '222 33'})] == ['Sunil Silva']
    assert [r['name'] for r in people(api, query={'search': 'cab1234'})] == ['Nimal Perera']
    assert len(people(api)) == 2
    hit = ok(api('GET', '/api/workshop/customers/lookup', query={'search': '77123'}, role='MECHANIC'))
    assert hit[0]['name'] == 'Nimal Perera' and hit[0]['vehicles'][0]['registration'] == 'CAB-1234'
    assert ok(api('GET', '/api/workshop/customers/lookup', query={'search': '77'}, role='MECHANIC')) == []  # too short to guess


def test_one_number_belongs_to_one_customer(api):
    made = ok(api('POST', '/api/workshop/customers', {'name': 'Fleet Co', 'phone': '011 222 3344', 'kind': 'FLEET', 'birthday': '12-25'}, role='ADMIN'))
    assert made['phone'] == '0112223344' and made['kind'] == 'FLEET' and made['birthday'] == '12-25'
    code, body = api('POST', '/api/workshop/customers', {'name': 'Someone else', 'phone': '+94112223344'})
    assert code == 409 and 'Fleet Co' in body['message']
    assert api('POST', '/api/workshop/customers', {'name': 'X', 'phone': '12345'})[0] == 400
    assert api('POST', '/api/workshop/customers', {'name': 'X', 'birthday': '02-30'})[0] == 400
    assert api('POST', '/api/workshop/customers', {'name': 'X', 'kind': 'VIP'})[0] == 400
    # a job with that number goes to Fleet Co instead of making a second one
    job(api, phone='0112223344', customer='Driver Ranjan')
    assert len(people(api)) == 1 and people(api)[0]['jobs'] == 1


def test_an_old_number_still_finds_the_customer(api):
    j = job(api)
    c = people(api)[0]
    full = ok(api('GET', '/api/workshop/customers/%s' % c['id']))
    ok(api('PATCH', '/api/workshop/customers/%s' % c['id'], {'revision': full['revision'], 'phone': '0701112222', 'name': 'Nimal Perera Jr'}))
    again = ok(api('GET', '/api/workshop/customers/%s' % c['id']))
    assert again['phone'] == '0701112222' and again['aliases'] == ['0771234567']
    # the vehicle file and the old paper still carry the old number: it must not make a second customer
    job(api, registration='CAB-9000', phone='0771234567', customer='Nimal')
    assert len(people(api)) == 1 and people(api)[0]['vehicles'] == 2
    # a stale save is refused
    assert api('PATCH', '/api/workshop/customers/%s' % c['id'], {'revision': full['revision'], 'notes': 'x'})[0] == 409
    assert api('PATCH', '/api/workshop/customers/%s' % c['id'], {'revision': again['revision'] + 1})[0] in (400, 409)
    assert j['id']


def test_a_number_cannot_be_taken_from_another_customer(api):
    job(api)
    other = ok(api('POST', '/api/workshop/customers', {'name': 'Kamal', 'phone': '0755550000'}))
    code, body = api('PATCH', '/api/workshop/customers/%s' % other['id'], {'revision': other['revision'], 'phone2': '0771234567'})
    assert code == 409 and 'Nimal' in body['message']


def test_merging_two_records_of_one_person(api, monkeypatch):
    from stocklane_api import customers
    ok(api('PUT', '/api/workshop/settings', BIZ))
    a = job(api)
    bill(api, a)
    b = job(api, registration='CAB-2222', phone='0719998888', customer='N Perera')
    bill(api, b, 1000)
    open_one = job(api, registration='CAB-2223', phone='0719998888', customer='N Perera')  # still open when the merge happens
    rows = {r['name']: r for r in people(api)}
    keep, drop = rows['Nimal Perera'], rows['N Perera']
    monkeypatch.setattr(customers, 'MOVE_AT_ONCE', 1)  # force the step-by-step path (a vehicle, a job and a bill to move)
    steps = []
    while True:
        r = ok(api('POST', '/api/workshop/customers/%s/merge' % drop['id'], {'into': keep['id']}))
        steps.append(r)
        if r['done']:
            break
        assert len(steps) < 10
    assert len(steps) == 5 and steps[0]['remaining'] == 4  # 2 vehicles, 2 jobs and a bill, one at a time
    left = people(api)
    assert len(left) == 1 and left[0]['vehicles'] == 3 and left[0]['jobs'] == 3
    one = ok(api('GET', '/api/workshop/customers/%s' % keep['id']))
    assert one['bills'] == 2 and one['owing'] == 3500 and one['phone2'] == '0719998888' and 'N Perera' in one['names']
    assert api('GET', '/api/workshop/customers/%s' % drop['id'])[0] == 404
    assert api('POST', '/api/workshop/customers/%s/merge' % drop['id'], {'into': keep['id']})[0] == 409  # already merged
    assert api('POST', '/api/workshop/customers/%s/merge' % keep['id'], {'into': keep['id']})[0] == 400
    # the second number now leads to the one that was kept
    job(api, registration='CAB-3333', phone='0719998888', customer='Whoever')
    assert len(people(api)) == 1 and people(api)[0]['vehicles'] == 4
    # a job saved after the merge keeps its new owner (the move bumped the revision)
    j = ok(api('GET', '/api/workshop/jobs/%s' % open_one['id']))
    ok(api('PATCH', '/api/workshop/jobs/%s' % open_one['id'], {'revision': j['revision'], 'notes': 'after merge'}))
    assert ok(api('GET', '/api/workshop/customers/%s' % keep['id']))['jobs'] == 4


def test_a_new_owner_changes_the_customer(api):
    job(api)
    ok(api('POST', '/api/workshop/vehicles/CAB1234/owner', {'owner': 'Sunil Silva', 'phone': '0712223333'}))
    by = {r['name']: r for r in people(api)}
    assert by['Sunil Silva']['vehicles'] == 1 and by['Nimal Perera']['vehicles'] == 0
    ok(api('PATCH', '/api/workshop/vehicles/CAB1234', {'phone': '0771234567'}))  # corrected back
    by = {r['name']: r for r in people(api)}
    assert by['Nimal Perera']['vehicles'] == 1 and by['Sunil Silva']['vehicles'] == 0


def test_what_is_owed_and_the_statement(api):
    ok(api('PUT', '/api/workshop/settings', BIZ))
    a = bill(api, job(api), 2500)
    b = bill(api, job(api, registration='CAB-4444'), 1500)
    ok(api('POST', '/api/workshop/invoices/%s/payments' % a['id'], {'amount': 1000, 'method': 'CASH'}))
    row = people(api)[0]
    assert row['owing'] == 3000
    full = ok(api('GET', '/api/workshop/customers/%s' % row['id']))
    assert full['spent'] == 4000 and full['owing'] == 3000 and full['bills'] == 2
    paid = [t for t in full['timeline'] if t['invoice_id'] == a['id']][0]
    assert paid['paid'] == 1000 and paid['balance'] == 1500 and paid['pay_status'] == 'PARTIAL'
    code, pdf = api('GET', '/api/workshop/customers/%s/statement.pdf' % row['id'])
    assert code == 200 and pdf['filename'].startswith('STATEMENT-') and len(pdf['pdf']) > 1000
    ok(api('POST', '/api/workshop/invoices/%s/payments' % a['id'], {'amount': 1500, 'method': 'CASH'}))
    ok(api('POST', '/api/workshop/invoices/%s/payments' % b['id'], {'amount': 1500, 'method': 'CASH'}))
    assert people(api)[0]['owing'] == 0
    assert api('GET', '/api/workshop/customers/%s/statement.pdf' % row['id'])[0] == 200  # nothing owed still prints


def test_inactive_customers_leave_the_list_but_keep_their_history(api):
    job(api)
    c = ok(api('GET', '/api/workshop/customers/%s' % people(api)[0]['id']))
    ok(api('PATCH', '/api/workshop/customers/%s' % c['id'], {'revision': c['revision'], 'active': False}))
    assert people(api) == [] and len(people(api, query={'inactive': '1'})) == 1
    assert ok(api('GET', '/api/workshop/customers/%s' % c['id']))['jobs'] == 1
    job(api, registration='CAB-8888')  # a new visit wakes the record up
    assert len(people(api)) == 1


def test_who_may_see_and_change_customers(api):
    job(api)
    cid = people(api)[0]['id']
    assert api('GET', '/api/workshop/customers', role='MECHANIC')[0] == 200  # mechanics see the list by default
    assert api('GET', '/api/workshop/customers/%s' % cid, role='MECHANIC')[0] == 200
    assert api('GET', '/api/workshop/customers', role='STOREKEEPER')[0] == 403
    assert api('GET', '/api/workshop/customers/%s/statement.pdf' % cid, role='STOREKEEPER')[0] == 403
    for method, path, body in (('POST', '/api/workshop/customers', {'name': 'X'}), ('PATCH', '/api/workshop/customers/%s' % cid, {'revision': 0, 'notes': 'x'}),
                               ('POST', '/api/workshop/customers/%s/merge' % cid, {'into': cid})):
        assert api(method, path, body, role='MECHANIC')[0] == 403, path
    assert api('POST', '/api/workshop/customers', {'name': 'Admin made'}, role='ADMIN')[0] == 200
    # the owner can take the list away from mechanics
    v = ok(api('GET', '/api/workshop/permissions'))
    ok(api('PUT', '/api/workshop/permissions', {'roles': dict(v['roles'], MECHANIC=[k for k in v['roles']['MECHANIC'] if k != 'customers_view'])}))
    assert api('GET', '/api/workshop/customers', role='MECHANIC')[0] == 403
    assert api('POST', '/api/workshop/jobs', dict(JOB, registration='ZZ-1111'), role='MECHANIC')[0] == 200  # but jobs still work


def test_each_shop_has_its_own_customers(api):
    job_a = ok(api('POST', '/api/workshop/jobs', dict(JOB, customer='ZZGANGA Nimal'), shop='ganga'))
    ok(api('POST', '/api/workshop/jobs', dict(JOB, registration='CAB-7777', customer='Other Shop Nimal'), shop='other'))  # the same number in another shop
    ganga, other = people(api, shop='ganga'), people(api, shop='other')
    assert [r['name'] for r in ganga] == ['ZZGANGA Nimal'] and [r['name'] for r in other] == ['Other Shop Nimal']
    assert api('GET', '/api/workshop/customers/%s' % ganga[0]['id'], shop='other')[0] == 404
    assert api('PATCH', '/api/workshop/customers/%s' % ganga[0]['id'], {'revision': 0, 'notes': 'x'}, shop='other')[0] == 404
    assert api('POST', '/api/workshop/customers/%s/merge' % ganga[0]['id'], {'into': other[0]['id']}, shop='other')[0] == 404
    assert job_a['id']


def test_export_includes_customers(api):
    job(api)
    assert [c['name'] for c in ok(api('GET', '/api/workshop/export'))['customers']] == ['Nimal Perera']
