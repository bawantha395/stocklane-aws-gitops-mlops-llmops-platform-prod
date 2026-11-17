"""The owner's daily summary by e-mail.

One SNS topic serves every shop. A shop's owner gives an address in Settings; Lifta subscribes it with a filter on the shop name, so a summary only
ever reaches the shop it is about. SNS sends the owner a confirmation mail first; until it is confirmed nothing is delivered. Off by default.

Stored: WSET/ownermail = {on, email, hour}. The job runs every hour and sends in the hour the owner chose (Sri Lanka time).
"""
import json
import os
import re
from datetime import datetime

from .core import COLOMBO, bad, command, get, now, put, shop

EMAIL = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
DEFAULT_HOUR = 19


def _topic():
    return os.environ.get('OWNER_TOPIC_ARN', '')


def _sns():
    import boto3
    return boto3.client('sns')


def _cfg():
    row = get('WSET', 'ownermail') or {}
    return {'on': row.get('on') is True, 'email': row.get('email') or '', 'hour': int(row.get('hour', DEFAULT_HOUR))}


def _mine():
    """This shop's subscriptions on the topic: [(endpoint, arn)]."""
    if not _topic():
        return []
    out, token = [], None
    while True:
        r = _sns().list_subscriptions_by_topic(TopicArn=_topic(), **({'NextToken': token} if token else {}))
        for s in r.get('Subscriptions', []):
            if s.get('Protocol') != 'email':
                continue
            try:
                policy = json.loads(_sns().get_subscription_attributes(SubscriptionArn=s['SubscriptionArn'])['Attributes'].get('FilterPolicy', '{}')) if s['SubscriptionArn'].startswith('arn:') else {}
            except Exception:  # noqa: BLE001 - a pending one has no attributes yet
                policy = {}
            if policy.get('shop') == [shop()] or s['SubscriptionArn'] == 'PendingConfirmation':
                out.append((s['Endpoint'], s['SubscriptionArn']))
        token = r.get('NextToken')
        if not token:
            return out


def view():
    c = _cfg()
    if not _topic():
        return dict(c, state='unavailable')
    state = 'off'
    if c['on'] and c['email']:
        state = 'pending'
        try:
            if any(e.lower() == c['email'].lower() and a.startswith('arn:') for e, a in _mine()):
                state = 'confirmed'
        except Exception:  # noqa: BLE001 - the screen still opens if SNS is slow
            state = 'pending'
    return dict(c, state=state)


def save(key, who, body):
    b = body or {}
    email = str(b.get('email') or '').strip()
    on = b.get('on') is True
    try:
        hour = int(b.get('hour', DEFAULT_HOUR))
    except (TypeError, ValueError):
        raise bad('Choose an hour from 0 to 23') from None
    if hour < 0 or hour > 23:
        raise bad('Choose an hour from 0 to 23')
    if on and not EMAIL.match(email):
        raise bad('Type the e-mail address the summary should go to')
    if len(email) > 120:
        raise bad('That e-mail address is too long')

    def build():
        old = _cfg()
        if on and _topic() and (email.lower() != old['email'].lower() or not old['on']):
            sns = _sns()
            for endpoint, arn in _mine():  # a changed address replaces the old one
                if endpoint.lower() != email.lower() and arn.startswith('arn:'):
                    sns.unsubscribe(SubscriptionArn=arn)
            sns.subscribe(TopicArn=_topic(), Protocol='email', Endpoint=email, ReturnSubscriptionArn=True,
                          Attributes={'FilterPolicy': json.dumps({'shop': [shop()]}), 'FilterPolicyScope': 'MessageAttributes'})
        item = {'pk': 'WSET', 'sk': 'ownermail', 'on': on, 'email': email, 'hour': hour, 'updated_at': now(), 'updated_by': who}
        return [put(item)], [None], None
    command(key, 'save-ownermail', who, b, build)
    return view()


def summary_text():
    """A short plain-text day: money in, what is owed, what needs the owner."""
    from . import alerts
    c = alerts.cockpit()
    lines = ['Today (Sri Lanka time ' + datetime.now(COLOMBO).strftime('%Y-%m-%d') + ')',
             'Billed: LKR %s' % format(c['today']['billed'], ',.2f'),
             'Money in: LKR %s' % format(c['today']['received'], ',.2f'),
             'Profit: LKR %s%s' % (format(c['today']['profit'], ',.2f'), ' (parts without a cost are left out)' if c['today']['profit_unknown'] else ''),
             'This month billed: LKR %s' % format(c['month']['billed'], ',.2f'),
             '',
             'Customers owe: LKR %s (%s bills%s)' % (format(c['owing'], ',.2f'), c['owing_count'], ', %s past terms' % c['overdue_count'] if c['overdue_count'] else ''),
             'Parts to order: %s' % c['to_order'],
             'Delete requests waiting: %s' % c['approvals'],
             'Alerts to look at: %s' % c['alerts'],
             'Customers to message: %s' % c['messages']]
    return '\n'.join(lines)


def _publish(text, subject):
    _sns().publish(TopicArn=_topic(), Subject=subject[:99], Message=text,
                   MessageAttributes={'shop': {'DataType': 'String', 'StringValue': shop()}})


def send_test(who):
    c = _cfg()
    if not _topic():
        raise bad('E-mail is not set up on this server yet')
    if not c['email']:
        raise bad('Save an e-mail address first')
    _publish('This is a test from Lifta. Your daily summary will look like this:\n\n' + summary_text(), 'Lifta: test summary')
    return {'sent': True}


def run_daily(hour=None):
    """Called every hour by the schedule, once per shop. Sends only to a shop that turned it on, in the hour it chose."""
    if not _topic():
        return {'sent': False, 'why': 'no topic'}
    c = _cfg()
    hour = datetime.now(COLOMBO).hour if hour is None else hour
    if not c['on'] or not c['email'] or c['hour'] != hour:
        return {'sent': False}
    _publish(summary_text(), 'Lifta: your day')
    return {'sent': True}
