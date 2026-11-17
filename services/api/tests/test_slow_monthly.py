"""Slow stock and the monthly PDF."""
from datetime import timedelta

from test_job_stock import new_job, use
from test_money_flow import BIZ, ok
from test_stock_count import product


def part(api, sku, name, qty=5, cost=None):
    p = ok(api('POST', '/api/inventory/products', {'partNumber': 'PN-' + sku, 'sku': sku, 'name': name, 'category': 'Filters', 'brand': 'Toyota', 'unit': 'UNIT',
                                                   'sellingPrice': 1800, 'reorderLevel': 1, 'openingQuantity': qty, 'location': ''}))
    if cost:
        ok(api('POST', '/api/inventory/movements', {'productId': p['id'], 'kind': 'RECEIPT', 'quantity': 1, 'unitCost': cost}))
    return p


def slow(api, **kw):
    return ok(api('GET', '/api/workshop/slow-stock', role='OWNER', **kw))


def test_slow_stock_lists_only_what_sat_still(api, monkeypatch):
    from stocklane_api import workshop
    ok(api('PUT', '/api/workshop/settings', BIZ))
    old, moving, empty = part(api, 'S-1', 'Old stock', 5, 1000), part(api, 'S-2', 'Moving part', 5, 500), part(api, 'S-3', 'Empty shelf', 0)
    assert slow(api)['count'] == 0  # all new
    today = workshop.today()
    monkeypatch.setattr(workshop, 'today', lambda: today + timedelta(days=120))
    got = slow(api)
    assert {i['name'] for i in got['items']} == {'Old stock', 'Moving part'}  # nothing with 0 stock
    assert got['value'] == 6000 + 3000 and got['categories'][0]['category'] == 'Filters' and got['categories'][0]['items'] == 2
    assert got['items'][0]['name'] == 'Old stock' and got['items'][0]['days'] >= 120
    # using one on a job today (120 days on) makes it not slow any more
    monkeypatch.setattr(workshop, 'today', lambda: today)
    ok(use(api, new_job(api, 'CAB-5555'), moving['id'], 1))
    monkeypatch.setattr(workshop, 'today', lambda: today + timedelta(days=120))
    assert {i['name'] for i in slow(api)['items']} == {'Old stock', 'Moving part'}  # sold 'today' is 120 days ago now
    monkeypatch.setattr(workshop, 'today', lambda: today + timedelta(days=60))
    assert slow(api, query={'days': '30'})['count'] == 2 and slow(api)['count'] == 0
    assert api('GET', '/api/workshop/slow-stock', query={'days': '5'}, role='OWNER')[0] == 400
    assert api('GET', '/api/workshop/slow-stock', query={'days': 'x'}, role='OWNER')[0] == 400
    assert slow(api, shop='other')['count'] == 0
    assert slow(api, query={'category': 'Tyres'})['count'] == 0
    assert old['id'] != empty['id']


def test_unknown_cost_is_listed_without_a_value(api, monkeypatch):
    from stocklane_api import workshop
    part(api, 'S-9', 'No cost', 3)
    today = workshop.today()
    monkeypatch.setattr(workshop, 'today', lambda: today + timedelta(days=100))
    got = slow(api)
    assert got['count'] == 1 and got['items'][0]['value'] is None and got['unknown_cost'] == 1 and got['value'] == 0


def test_permissions(api):
    for role in ('MECHANIC', 'STOREKEEPER'):
        assert api('GET', '/api/workshop/slow-stock', role=role)[0] == 403
        assert api('GET', '/api/workshop/monthly.pdf', role=role)[0] == 403


def test_monthly_pdf(api):
    ok(api('PUT', '/api/workshop/settings', BIZ))
    new_job(api)
    out = ok(api('GET', '/api/workshop/monthly.pdf', role='OWNER'))
    assert out['pdf']
    assert api('GET', '/api/workshop/monthly.pdf', query={'month': 'nope'}, role='OWNER')[0] == 400
    assert api('GET', '/api/workshop/monthly.pdf', query={'month': '2099-01'}, role='OWNER')[0] == 400
    assert ok(api('GET', '/api/workshop/monthly.pdf', query={'month': '2020-03'}, role='OWNER'))['pdf']
