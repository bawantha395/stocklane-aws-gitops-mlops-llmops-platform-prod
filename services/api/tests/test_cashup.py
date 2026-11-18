"""Cash-up and day lock: both optional, both off until the owner turns them on in Settings."""
from datetime import datetime

from test_customers import bill, job
from test_money_flow import ok
from stocklane_api.core import COLOMBO


def today():
    return datetime.now(COLOMBO).date().isoformat()


def turn_on(api, lock=False):
    s = ok(api('GET', '/api/workshop/settings'))
    ok(api('PUT', '/api/workshop/settings', dict(s, cash_up_on=True, day_lock_on=lock)))


def test_cash_up_is_off_until_it_is_turned_on(api):
    assert api('GET', '/api/workshop/cashup')[0] == 404
    s = ok(api('GET', '/api/workshop/settings'))
    assert s['cash_up_on'] is False and s['day_lock_on'] is False
    turn_on(api)
    assert ok(api('GET', '/api/workshop/cashup'))['expected_cash'] == 0


def test_the_day_adds_up_what_was_taken_and_a_difference_needs_a_note(api):
    turn_on(api)
    inv = bill(api, job(api), 2500)
    ok(api('POST', '/api/workshop/invoices/%s/payments' % inv['id'], {'amount': 2000, 'method': 'CASH'}))
    ok(api('POST', '/api/workshop/invoices/%s/payments' % inv['id'], {'amount': 500, 'method': 'CARD'}))
    day = ok(api('GET', '/api/workshop/cashup'))
    assert float(day['expected_cash']) == 2000 and day['payments'] == 2 and day['row'] is None
    assert api('POST', '/api/workshop/cashup', {'date': today(), 'counted': '1950'})[0] == 400  # 50 short, no note
    closed = ok(api('POST', '/api/workshop/cashup', {'date': today(), 'counted': '1950', 'note': 'Change given by mistake'}))
    assert float(closed['variance']) == -50 and closed['status'] == 'CLOSED'
    assert api('POST', '/api/workshop/cashup', {'date': today(), 'counted': '2000'})[0] == 409  # already closed
    assert ok(api('GET', '/api/workshop/cashup/history'))[0]['date'] == today()
    assert api('POST', '/api/workshop/cashup', {'date': '2999-01-01', 'counted': '0'})[0] == 400  # a day that has not come


def test_a_closed_day_stays_open_to_money_when_the_lock_is_off(api):
    turn_on(api, lock=False)
    inv = bill(api, job(api), 1000)
    ok(api('POST', '/api/workshop/cashup', {'date': today(), 'counted': '0'}))
    ok(api('POST', '/api/workshop/invoices/%s/payments' % inv['id'], {'amount': 1000, 'method': 'CASH'}))


def test_a_closed_day_cannot_change_when_the_lock_is_on_and_the_owner_can_reopen_it(api):
    turn_on(api, lock=True)
    inv = bill(api, job(api), 1000)
    ok(api('POST', '/api/workshop/invoices/%s/payments' % inv['id'], {'amount': 400, 'method': 'CASH'}))
    ok(api('POST', '/api/workshop/cashup', {'date': today(), 'counted': '400'}))
    assert api('POST', '/api/workshop/invoices/%s/payments' % inv['id'], {'amount': 100, 'method': 'CASH'})[0] == 409
    assert api('POST', '/api/workshop/invoices/%s/refund' % inv['id'], {'amount': 100, 'method': 'CASH', 'reason': 'x'})[0] == 409
    other = bill(api, job(api, registration='CAB-9999'), 800)
    assert api('POST', '/api/workshop/invoices/%s/void' % other['id'], {'reason': 'Mistake'})[0] == 409
    assert api('POST', '/api/workshop/cashup/reopen', {'date': today(), 'reason': 'Forgot a payment'}, role='MECHANIC')[0] == 403  # owner only
    assert api('POST', '/api/workshop/cashup/reopen', {'date': today()})[0] == 400  # a reason is needed
    ok(api('POST', '/api/workshop/cashup/reopen', {'date': today(), 'reason': 'Forgot a payment'}))
    ok(api('POST', '/api/workshop/invoices/%s/payments' % inv['id'], {'amount': 100, 'method': 'CASH'}))
    again = ok(api('POST', '/api/workshop/cashup', {'date': today(), 'counted': '500'}))
    assert float(again['variance']) == 0


def test_the_lock_needs_cash_up_and_the_screen_needs_its_permission(api):
    s = ok(api('GET', '/api/workshop/settings'))
    saved = ok(api('PUT', '/api/workshop/settings', dict(s, cash_up_on=False, day_lock_on=True)))
    assert saved['day_lock_on'] is False
    turn_on(api)
    assert api('GET', '/api/workshop/cashup', role='MECHANIC')[0] == 403
