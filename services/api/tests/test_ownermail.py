"""The owner's e-mail summary (SNS topic with a filter per shop) and the alert for a customer's answer to an estimate."""
import boto3
import pytest
from test_links import BIZ, post, sent_estimate
from test_money_flow import ok


@pytest.fixture
def topic(api, monkeypatch):
    arn = boto3.client('sns').create_topic(Name='owner-mail')['TopicArn']
    monkeypatch.setenv('OWNER_TOPIC_ARN', arn)
    return arn


def test_off_by_default_and_unavailable_without_a_topic(api, monkeypatch):
    monkeypatch.delenv('OWNER_TOPIC_ARN', raising=False)
    assert ok(api('GET', '/api/workshop/owner-mail'))['state'] == 'unavailable'


def test_turning_it_on_needs_an_address_and_subscribes_it_for_this_shop_only(api, topic):
    v = ok(api('GET', '/api/workshop/owner-mail'))
    assert v['on'] is False and v['state'] == 'off' and v['hour'] == 19
    assert api('PUT', '/api/workshop/owner-mail', {'on': True, 'email': 'nope', 'hour': 19})[0] == 400
    assert api('PUT', '/api/workshop/owner-mail', {'on': False, 'email': '', 'hour': 30})[0] == 400
    got = ok(api('PUT', '/api/workshop/owner-mail', {'on': True, 'email': 'boss@example.com', 'hour': 20}))
    assert got['on'] is True and got['email'] == 'boss@example.com' and got['hour'] == 20 and got['state'] in ('pending', 'confirmed')  # real SNS waits for the confirmation mail; the test double confirms at once
    subs = boto3.client('sns').list_subscriptions_by_topic(TopicArn=topic)['Subscriptions']
    assert [s['Endpoint'] for s in subs] == ['boss@example.com']
    assert api('PUT', '/api/workshop/owner-mail', {'on': True, 'email': 'x@example.com', 'hour': 9}, role='MECHANIC')[0] == 403


def test_the_daily_job_sends_only_in_the_chosen_hour_to_shops_that_turned_it_on(api, topic):
    from stocklane_api import handler, ownermail
    sent = []
    ownermail._publish = lambda text, subject: sent.append((subject, text))
    ok(api('PUT', '/api/workshop/owner-mail', {'on': True, 'email': 'boss@example.com', 'hour': 20}))
    assert ownermail.run_daily(hour=19) == {'sent': False} and not sent
    from stocklane_api import core
    core.no_shop(); core.set_shop(core.default_shop())
    assert ownermail.run_daily(hour=20) == {'sent': True}
    assert 'Billed: LKR' in sent[0][1] and 'Customers owe' in sent[0][1]
    out = handler.scheduled({'job': 'daily-summary'})
    assert set(out) >= {core.default_shop()}


def test_a_customer_answering_an_estimate_raises_an_alert(api):
    ok(api('PUT', '/api/workshop/settings', BIZ))
    q = sent_estimate(api)
    token = ok(api('POST', '/api/workshop/quotes/%s/link' % q['id'], {}, role='MECHANIC'))['link']['token']
    assert post(token, '/decision', {'decision': 'APPROVE', 'name': 'Nimal'})[0] == 200
    a = [x for x in ok(api('GET', '/api/workshop/alerts'))['alerts'] if x['type'] == 'ESTIMATE_DECISION']
    assert len(a) == 1 and 'approved' in a[0]['title'] and a[0]['by'] == 'Nimal'
    ok(api('POST', '/api/workshop/alerts/seen', {'keys': [a[0]['key']]}))
    assert ok(api('GET', '/api/workshop/alerts'))['unseen'] == 0
