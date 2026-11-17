"""The message centre: rules, one row per customer, the log, opt-out, and who may see it."""
from test_money_flow import BIZ, fill, new_job, ok


def rows(api, **kw):
    return ok(api('GET', '/api/workshop/messages', role='ADMIN', **kw))


def ready_job(api, reg='CAB-1234', phone='0771234567', name='Nimal Perera'):
    ok(api('PUT', '/api/workshop/settings', BIZ))
    j = new_job(api, reg, customer=name, phone=phone)
    ok(api('POST', '/api/workshop/jobs/%s/stage' % j['id'], {'stage': 'READY'}, role='MECHANIC'))
    return j


def test_a_ready_vehicle_is_offered_once_then_never_again(api):
    j = ready_job(api)
    r = rows(api)
    assert r['count'] == 1 and r['rows'][0]['types'] == ['READY'] and r['rows'][0]['phone'] == '0771234567'
    assert 'CAB-1234 is ready' in r['rows'][0]['message'] and 'Ganga Motors' in r['rows'][0]['message'] and r['rows'][0]['name'] == 'Nimal Perera'
    item = r['rows'][0]['items'][0]
    assert item['ref'] == j['id']
    ok(api('POST', '/api/workshop/messages/log', {'status': 'SENT', 'items': [{'type': 'READY', 'ref': item['ref']}]}, role='ADMIN'))
    assert rows(api)['count'] == 0
    assert ok(api('GET', '/api/workshop/messages/count', role='ADMIN')) == {'count': 0}


def test_later_hides_it_for_today_and_skip_for_good(api):
    j = ready_job(api)
    ok(api('POST', '/api/workshop/messages/log', {'status': 'LATER', 'items': [{'type': 'READY', 'ref': j['id']}]}, role='ADMIN'))
    assert rows(api)['count'] == 0  # comes back tomorrow (later_until is after today)
    ok(api('POST', '/api/workshop/messages/log', {'status': 'SKIPPED', 'items': [{'type': 'READY', 'ref': j['id']}]}, role='ADMIN'))
    assert rows(api)['count'] == 0
    assert api('POST', '/api/workshop/messages/log', {'status': 'NOPE', 'items': [{'type': 'READY', 'ref': j['id']}]}, role='ADMIN')[0] == 400
    assert api('POST', '/api/workshop/messages/log', {'status': 'SENT', 'items': [{'type': 'WHAT', 'ref': 'x'}]}, role='ADMIN')[0] == 400
    assert api('POST', '/api/workshop/messages/log', {'status': 'SENT', 'items': []}, role='ADMIN')[0] == 400


def test_one_customer_with_two_reasons_is_one_row(api):
    j = ready_job(api)
    ok(fill(api, j['id'], role='OWNER'))
    # the same customer: bill paid today (thank you) and the car ready
    inv = ok(api('POST', '/api/workshop/jobs/%s/invoice' % j['id'], {'revision': 1}, role='MECHANIC'))
    ok(api('POST', '/api/workshop/invoices/%s/payments' % inv['id'], {'amount': inv['total'], 'method': 'CASH'}, role='MECHANIC'))
    r = rows(api)
    thanks = [g for g in r['rows'] if 'THANKS' in g['types']]
    assert len(thanks) == 1 and r['counts']['THANKS'] == 1
    assert 'Thank you' in thanks[0]['message'] or 'thank you' in thanks[0]['message']


def test_opt_out_and_no_phone(api):
    ok(api('PUT', '/api/workshop/settings', BIZ))
    a = ready_job(api, 'AAA-1111', '0771111111', 'Opt Out')
    cust = [c for c in ok(api('GET', '/api/workshop/customers', role='OWNER')) if c['name'] == 'Opt Out'][0]
    assert cust['no_messages'] is False
    full = ok(api('GET', '/api/workshop/customers/' + cust['id'], role='OWNER'))
    ok(api('PATCH', '/api/workshop/customers/' + cust['id'], {'no_messages': True, 'revision': full['revision']}, role='OWNER'))
    nophone = new_job(api, 'BBB-2222', customer='No Phone', phone='')
    ok(api('POST', '/api/workshop/jobs/%s/stage' % nophone['id'], {'stage': 'READY'}, role='MECHANIC'))
    r = rows(api)
    named = {g['name']: g for g in r['rows']}
    assert 'Opt Out' not in named  # asked for no messages
    assert 'No Phone' in named and named['No Phone']['phone'] == ''  # shown so it can be skipped, but there is nobody to send to
    assert a['id'] not in [i['ref'] for g in r['rows'] for i in g['items']]


def test_birthday_reminder_winback_and_service_due(api, monkeypatch):
    from datetime import timedelta
    from stocklane_api import workshop
    ok(api('PUT', '/api/workshop/settings', BIZ))
    today = workshop.today()
    ok(api('POST', '/api/workshop/customers', {'name': 'Birthday Bob', 'phone': '0772223334', 'birthday': today.strftime('%m-%d')}, role='OWNER'))
    ok(api('POST', '/api/workshop/customers', {'name': 'Other Day', 'phone': '0773334445', 'birthday': (today + timedelta(days=3)).strftime('%m-%d')}, role='OWNER'))
    r = rows(api)
    assert [g['name'] for g in r['rows']] == ['Birthday Bob'] and r['rows'][0]['types'] == ['BIRTHDAY']
    ok(api('POST', '/api/workshop/messages/log', {'status': 'SENT', 'items': [{'type': 'BIRTHDAY', 'ref': r['rows'][0]['items'][0]['ref']}]}, role='ADMIN'))
    assert rows(api)['count'] == 0
    # a customer not seen for 6 months and a bill past its terms, a week apart
    j = new_job(api, 'OLD-0001', customer='Long Gone', phone='0775556667')
    ok(fill(api, j['id'], role='OWNER'))
    inv = ok(api('POST', '/api/workshop/jobs/%s/invoice' % j['id'], {'revision': 1}, role='MECHANIC'))
    monkeypatch.setattr(workshop, 'today', lambda: today + timedelta(days=20))
    pay = [g for g in rows(api)['rows'] if g['name'] == 'Nimal Perera' or g['name'] == 'Long Gone'][0]
    assert 'PAYMENT' in pay['types'] and 'LKR' in pay['message']
    ref = [i['ref'] for i in pay['items'] if i['type'] == 'PAYMENT'][0]
    ok(api('POST', '/api/workshop/messages/log', {'status': 'SENT', 'items': [{'type': 'PAYMENT', 'ref': ref}]}, role='ADMIN'))
    assert not [g for g in rows(api)['rows'] if 'PAYMENT' in g['types']]
    monkeypatch.setattr(workshop, 'today', lambda: today + timedelta(days=28))  # a week later it is offered again
    assert [g for g in rows(api)['rows'] if 'PAYMENT' in g['types']]
    monkeypatch.setattr(workshop, 'today', lambda: today + timedelta(days=200))
    assert [g for g in rows(api)['rows'] if 'WINBACK' in g['types']]
    # service due (the date set on the job is in the future; 200 days on it is overdue)
    assert 'SERVICE' in [t for g in rows(api)['rows'] for t in g['types']]


def test_permission_and_isolation(api):
    ready_job(api)
    assert api('GET', '/api/workshop/messages', role='MECHANIC')[0] == 403
    assert api('GET', '/api/workshop/messages/count', role='MECHANIC')[0] == 403
    assert api('POST', '/api/workshop/messages/log', {'status': 'SENT', 'items': [{'type': 'READY', 'ref': 'x'}]}, role='MECHANIC')[0] == 403
    assert rows(api, shop='other')['count'] == 0


def test_templates_language_and_history(api):
    j = ready_job(api)
    base = rows(api)['rows'][0]
    assert 'ready for collection' in base['message']
    # owner edits the English words; the Sinhala ones stay built-in
    view = ok(api('GET', '/api/workshop/messages/templates', role='ADMIN'))
    assert 'name' in view['variables'] and view['templates']['READY']['en'].startswith('Hello {name}')
    ok(api('PUT', '/api/workshop/messages/templates', {'templates': {'READY': {'en': 'Hi {name}, {vehicle} is done. See you at {shop}', 'si': ''}}}, role='OWNER'))
    assert rows(api)['rows'][0]['message'] == 'Hi Nimal Perera, CAB-1234 is done. See you at Ganga Motors'
    assert ok(api('GET', '/api/workshop/messages/templates', role='ADMIN'))['custom']['READY'] == ['en']
    # a Sinhala customer gets Sinhala only when the shop allows it
    cust = [c for c in ok(api('GET', '/api/workshop/customers', role='OWNER')) if c['name'] == 'Nimal Perera'][0]
    full = ok(api('GET', '/api/workshop/customers/' + cust['id'], role='OWNER'))
    ok(api('PATCH', '/api/workshop/customers/' + cust['id'], {'lang': 'si', 'revision': full['revision']}, role='OWNER'))
    assert 'Hi Nimal' in rows(api)['rows'][0]['message']
    ok(api('PUT', '/api/workshop/settings', {**BIZ, 'sinhala': True}))
    assert 'ආයුබෝවන්' in rows(api)['rows'][0]['message'] and 'CAB-1234' in rows(api)['rows'][0]['message']
    # bad input
    assert api('PUT', '/api/workshop/messages/templates', {'templates': {'NOPE': {'en': 'x'}}}, role='OWNER')[0] == 400
    assert api('PUT', '/api/workshop/messages/templates', {'templates': {'READY': {'en': 'x' * 601}}}, role='OWNER')[0] == 400
    assert api('PUT', '/api/workshop/messages/templates', {'templates': {}}, role='ADMIN')[0] in (200, 403)
    assert api('GET', '/api/workshop/messages/templates', role='MECHANIC')[0] == 403
    # the log says who pressed Sent, and the same message is not offered again
    ok(api('POST', '/api/workshop/messages/log', {'status': 'SENT', 'items': [{'type': 'READY', 'ref': j['id'], 'name': 'Nimal Perera'}]}, role='ADMIN', who='amal'))
    h = ok(api('GET', '/api/workshop/messages/history', role='ADMIN'))
    assert h[0]['by'] == 'amal' and h[0]['status'] == 'SENT' and h[0]['name'] == 'Nimal Perera'
    assert rows(api)['count'] == 0
    assert rows(api, shop='other')['count'] == 0 and ok(api('GET', '/api/workshop/messages/history', role='ADMIN', shop='other')) == []


def test_ready_message_carries_the_customer_link(api):
    from stocklane_api import handler
    j = ready_job(api)
    r = ok(api('GET', '/api/workshop/messages', role='ADMIN', query={'origin': 'https://shop.example.com'}))
    msg = r['rows'][0]['message']
    assert 'https://shop.example.com/t/main~' in msg
    token = msg.split('/t/')[1].split()[0]
    from test_links import public
    assert public(token)[1]['job']['registration'] == 'CAB-1234'
    # no site address, or a strange one: no link, and the message still reads fine
    for origin in ('', 'http://x.com', 'javascript:alert(1)', 'https://a b'):
        text = ok(api('GET', '/api/workshop/messages', role='ADMIN', query={'origin': origin}))['rows'][0]['message']
        assert '/t/' not in text and 'ready for collection' in text
    # asking again does not make a second link
    again = ok(api('GET', '/api/workshop/messages', role='ADMIN', query={'origin': 'https://shop.example.com'}))['rows'][0]['message']
    assert again == msg
