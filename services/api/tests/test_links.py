"""Customer links: the public page shows one job and nothing private; wrong, expired and revoked links all look the same; guessing is slowed down."""
import json
from datetime import timedelta

from test_money_audit import setup
from test_money_flow import BIZ, ok


def public(token, ip='1.2.3.4', suffix=''):
    from stocklane_api import handler
    event = {'requestContext': {'http': {'method': 'GET', 'sourceIp': ip}}, 'rawPath': '/api/public/track/' + token + suffix, 'headers': {}, 'queryStringParameters': {}}
    r = handler.handler(event)
    return r['statusCode'], json.loads(r['body']), r['headers']


def link(api, job_id, **body):
    return ok(api('POST', '/api/workshop/jobs/%s/link' % job_id, body, role='MECHANIC'))['link']


def test_the_page_shows_the_job_and_nothing_private(api):
    p, j = setup(api)  # a stock part (cost 900), an outside bulb (cost 300), a discount
    token = link(api, j['id'])['token']
    status, page, headers = public(token)
    assert status == 200 and headers['Cache-Control'] == 'no-store'
    assert page['job']['registration'] == 'CAB-1234' and page['shop']['name'] == 'Ganga Motors'
    names = {x['name'] for x in page['work']['parts']}
    assert 'Bulb' in names and page['work']['total'] > 0 and page['invoice'] is None
    text = json.dumps(page).lower()
    for secret in ('cost', 'profit', 'created_by', 'kasun', 'mechanic', 'phone2', 'outside', 'supplier', 'owner@example.com'):
        assert secret not in text, secret
    assert page['shop'].keys() == {'name', 'address', 'phone'}


def test_the_bill_shows_once_it_is_made_and_a_void_hides_it(api):
    p, j = setup(api)
    token = link(api, j['id'])['token']
    inv = ok(api('POST', '/api/workshop/jobs/%s/invoice' % j['id'], {'revision': j['revision']}, role='MECHANIC'))
    ok(api('POST', '/api/workshop/invoices/%s/payments' % inv['id'], {'amount': 1000, 'method': 'CASH'}, role='MECHANIC'))
    page = public(token)[1]
    assert page['invoice']['status'] == 'PARTIAL' and page['invoice']['paid'] == 1000 and page['invoice']['balance'] == inv['total'] - 1000
    assert page['invoice']['bank'] == 'BOC 1234567' and page['work']['total'] == inv['total']
    assert 'payments' not in json.dumps(page) and 'method' not in page['invoice']


def test_wrong_expired_and_revoked_all_look_the_same(api, monkeypatch):
    from stocklane_api import workshop
    p, j = setup(api)
    good = link(api, j['id'], days=5)['token']
    same = {'message': 'Not found'}
    assert public('main~nothing')[:2] == (404, same) and public('nodash')[:2] == (404, same) and public('zz~' + good.split('~')[1])[:2] == (404, same)
    assert public(good)[0] == 200
    today = workshop.today()
    monkeypatch.setattr(workshop, 'today', lambda: today + timedelta(days=6))
    assert public(good, ip='9.9.9.9')[:2] == (404, same)  # expired
    monkeypatch.undo()
    assert ok(api('POST', '/api/workshop/jobs/%s/link/revoke' % j['id'], {}, role='MECHANIC'))['revoked'] == 1
    assert public(good, ip='8.8.8.8')[:2] == (404, same)
    assert ok(api('GET', '/api/workshop/jobs/%s/link' % j['id']))['link'] is None
    new = link(api, j['id'])  # a fresh one can be made after a revoke
    assert new['token'] != good and public(new['token'], ip='7.7.7.7')[0] == 200


def test_asking_twice_returns_the_same_link_and_counts_views(api):
    p, j = setup(api)
    a, b = link(api, j['id']), link(api, j['id'])
    assert a['token'] == b['token']
    public(a['token']), public(a['token'])
    assert ok(api('GET', '/api/workshop/jobs/%s/link' % j['id']))['link']['views'] == 2
    assert api('POST', '/api/workshop/jobs/%s/link' % j['id'], {'days': 0}, role='MECHANIC')[0] == 400
    assert api('POST', '/api/workshop/jobs/%s/link' % j['id'], {'days': 999}, role='MECHANIC')[0] == 400


def test_guessing_is_slowed_down(api):
    for n in range(20):
        assert public('main~guess%d' % n, ip='6.6.6.6')[0] == 404
    assert public('main~guess99', ip='6.6.6.6')[0] == 429  # the 21st wrong guess in 10 minutes is refused
    assert public('main~guess100', ip='6.6.6.6')[0] == 429
    p, j = setup(api)
    good = link(api, j['id'])['token']
    assert public(good, ip='6.6.6.6')[0] == 429  # even the right link waits while the address is blocked
    assert public(good, ip='5.5.5.5')[0] == 200   # someone else is not affected


def test_a_link_never_opens_another_shop_or_job(api):
    p, j = setup(api)
    good = link(api, j['id'])['token']
    # the same secret under another shop name is just a wrong link
    other = 'other-shop~' + good.split('~', 1)[1]
    assert public(other)[0] == 404
    # staff routes still need a sign-in: the public route does not open them
    from stocklane_api import handler
    event = {'requestContext': {'http': {'method': 'GET', 'sourceIp': '3.3.3.3'}}, 'rawPath': '/api/workshop/jobs/' + j['id'], 'headers': {}, 'queryStringParameters': {}}
    assert handler.handler(event)['statusCode'] in (401, 403)


def test_photos_only_from_this_job(api):
    p, j = setup(api)
    token = link(api, j['id'])['token']
    assert public(token, suffix='/photo/' + 'a' * 32)[0] == 404   # not one of this job's photos
    assert public(token, suffix='/photo/..%2fx')[0] == 404


def test_only_staff_with_the_jobs_permission_make_links(api):
    p, j = setup(api)
    assert api('POST', '/api/workshop/jobs/%s/link' % j['id'], {}, role='STOREKEEPER')[0] == 403
    assert api('POST', '/api/workshop/jobs/%s/link/revoke' % j['id'], {}, role='STOREKEEPER')[0] == 403
    assert api('POST', '/api/workshop/jobs/%s/link' % j['id'], {}, role='MECHANIC')[0] == 200


# ---------- 5B: estimate answers and photos ----------
def post(token, suffix, body, ip='1.2.3.4'):
    from stocklane_api import handler
    event = {'requestContext': {'http': {'method': 'POST', 'sourceIp': ip}}, 'rawPath': '/api/public/track/' + token + suffix, 'headers': {}, 'queryStringParameters': {},
             'body': json.dumps(body)}
    r = handler.handler(event)
    return r['statusCode'], json.loads(r['body'])


def sent_estimate(api, **extra):
    from test_quotes import make
    q = make(api, customer='Nimal Perera', phone='0771234567', photos=[], parts=[{'name': 'Clips', 'quantity': 1, 'unit_price': 800}], **extra)
    return ok(api('POST', '/api/workshop/quotes/%s/status' % q['id'], {'revision': q['revision'], 'status': 'SENT'}))


def test_the_customer_sees_the_estimate_and_approves_once(api):
    ok(api('PUT', '/api/workshop/settings', BIZ))
    q = sent_estimate(api)
    token = ok(api('POST', '/api/workshop/quotes/%s/link' % q['id'], {}, role='MECHANIC'))['link']['token']
    page = public(token)[1]
    assert page['kind'] == 'quote' and page['quote']['can_decide'] is True and page['quote']['total'] == 26900 and page['quote']['decision'] is None
    text = json.dumps(page).lower()
    for secret in ('insurer', 'claim', 'cost', 'created_by', 'owner@example.com', 'status_by', 'history'):
        assert secret not in text, secret
    assert post(token, '/decision', {'decision': 'APPROVE', 'name': ''})[0] == 400
    assert post(token, '/decision', {'decision': 'MAYBE', 'name': 'Nimal'})[0] == 400
    status, got = post(token, '/decision', {'decision': 'APPROVE', 'name': 'Nimal  Perera'})
    assert status == 200 and got['status'] == 'APPROVED' and got['name'] == 'Nimal Perera'
    # the workshop sees who answered and when; the customer cannot answer again or change it
    staff = ok(api('GET', '/api/workshop/quotes/' + q['id']))
    assert staff['status'] == 'APPROVED' and staff['customer_decision']['name'] == 'Nimal Perera' and staff['customer_decision']['at'] and staff['status_by'] == 'customer'
    assert post(token, '/decision', {'decision': 'DECLINE', 'name': 'Someone'})[0] == 409
    again = public(token)[1]['quote']
    assert again['can_decide'] is False and again['decision']['decision'] == 'APPROVE'


def test_decline_and_not_sent_and_expired(api, monkeypatch):
    from stocklane_api import workshop
    from test_quotes import make
    draft = make(api, customer='Nimal Perera', phone='0771234567', photos=[])
    t1 = ok(api('POST', '/api/workshop/quotes/%s/link' % draft['id'], {}, role='MECHANIC'))['link']['token']
    assert public(t1)[1]['quote']['can_decide'] is False and post(t1, '/decision', {'decision': 'APPROVE', 'name': 'Nimal'})[0] == 409  # still a draft
    q = sent_estimate(api, valid_until=(workshop.today() + timedelta(days=2)).isoformat())
    t2 = ok(api('POST', '/api/workshop/quotes/%s/link' % q['id'], {}, role='MECHANIC'))['link']['token']
    today = workshop.today()
    monkeypatch.setattr(workshop, 'today', lambda: today + timedelta(days=3))
    assert public(t2, ip='2.2.2.2')[1]['quote']['expired'] is True
    assert post(t2, '/decision', {'decision': 'APPROVE', 'name': 'Nimal'}, ip='2.2.2.2')[0] == 409  # ran out
    monkeypatch.undo()
    assert post(t2, '/decision', {'decision': 'DECLINE', 'name': 'Nimal'}, ip='2.2.2.3')[1]['status'] == 'REJECTED'


def test_a_job_link_cannot_answer_and_after_conversion_the_link_follows_the_job(api):
    p, j = setup(api)
    jt = link(api, j['id'])['token']
    assert post(jt, '/decision', {'decision': 'APPROVE', 'name': 'Nimal'})[0] == 404
    q = sent_estimate(api)
    token = ok(api('POST', '/api/workshop/quotes/%s/link' % q['id'], {}, role='MECHANIC'))['link']['token']
    post(token, '/decision', {'decision': 'APPROVE', 'name': 'Nimal'})
    q = ok(api('GET', '/api/workshop/quotes/' + q['id']))
    ok(api('POST', '/api/workshop/quotes/%s/convert' % q['id'], {'revision': q['revision']}))
    page = public(token)[1]
    assert page['kind'] == 'job' and page['job']['registration'] == 'CAB-1000'


def test_quote_links_need_the_quotes_permission_and_stay_in_the_shop(api):
    q = sent_estimate(api)
    assert api('POST', '/api/workshop/quotes/%s/link' % q['id'], {}, role='STOREKEEPER')[0] == 403
    token = ok(api('POST', '/api/workshop/quotes/%s/link' % q['id'], {}, role='MECHANIC'))['link']['token']
    assert ok(api('POST', '/api/workshop/quotes/%s/link/revoke' % q['id'], {}, role='MECHANIC'))['revoked'] == 1
    assert public(token)[0] == 404 and post(token, '/decision', {'decision': 'APPROVE', 'name': 'Nimal'})[0] == 404
    assert api('GET', '/api/workshop/quotes/%s/link' % q['id'], shop='other')[0] == 404


def test_after_and_old_part_photos(api):
    import boto3
    boto3.client('s3', region_name='ap-southeast-2').create_bucket(Bucket='test-media', CreateBucketConfiguration={'LocationConstraint': 'ap-southeast-2'})
    p, j = setup(api)
    after, old, before = 'a' * 32, 'b' * 32, 'c' * 32
    for pid in (after, old, before):
        boto3.client('s3', region_name='ap-southeast-2').put_object(Bucket='test-media', Key='workshop/photos/%s-t.jpg' % pid, Body=b'\xff\xd8x')
    got = ok(api('POST', '/api/workshop/jobs/%s/photos' % j['id'], {'add': [before], 'add_after': [after], 'add_old': [old]}, role='MECHANIC'))
    assert got['before_photos'] == [before] and got['after_photos'] == [after] and got['old_photos'] == [old]
    full = ok(api('GET', '/api/workshop/jobs/' + j['id']))
    assert full['after_photos'] == [after] and full['old_photos'] == [old]
    token = link(api, j['id'])['token']
    assert public(token)[1]['photos'] == {'before': [before], 'after': [after], 'old': [old]}
    assert public(token, suffix='/photo/' + old)[0] == 200 and public(token, suffix='/photo/' + 'd' * 32)[0] == 404
    got = ok(api('POST', '/api/workshop/jobs/%s/photos' % j['id'], {'remove_old': [old]}, role='MECHANIC'))
    assert got['old_photos'] == [] and got['after_photos'] == [after]
    assert api('POST', '/api/workshop/jobs/%s/photos' % j['id'], {'add_after': ['%032x' % n for n in range(7)]}, role='MECHANIC')[0] == 400
