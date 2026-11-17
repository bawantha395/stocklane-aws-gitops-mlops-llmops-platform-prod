"""Selling price, markup, suggested price and the price review."""
from test_money_flow import BIZ, ok
from test_shops import PART
from test_suppliers import part


def stock_in(api, p, cost, qty=1):
    ok(api('POST', '/api/inventory/movements', {'productId': p['id'], 'kind': 'RECEIPT', 'quantity': qty, 'unitCost': cost}))


def product(api, pid, **kw):
    return next(x for x in ok(api('GET', '/api/inventory/products', **kw)) if x['id'] == pid)


def test_the_price_can_be_changed_and_the_change_is_logged(api):
    p = part(api)
    r = ok(api('POST', '/api/inventory/products/%s/price' % p['id'], {'price': 1750.5}))
    assert r['selling_price'] == 1750.5
    h = ok(api('GET', '/api/inventory/products/%s/price-history' % p['id']))
    assert len(h) == 1 and h[0]['old'] == 1500 and h[0]['new'] == 1750.5 and h[0]['by']
    for body in ({'price': -1}, {'price': 'x'}, {'price': 1.234}, {'price': 20000000}, {}, {'price': 1750.5}):
        assert api('POST', '/api/inventory/products/%s/price' % p['id'], body)[0] == 400, body
    assert api('POST', '/api/inventory/products/nope/price', {'price': 5})[0] == 404


def test_the_suggested_price_is_cost_plus_markup_rounded_up_to_five(api):
    p = part(api)
    stock_in(api, p, 1000)
    assert product(api, p['id'])['suggested_price'] is None  # no markup set yet
    ok(api('PUT', '/api/workshop/settings', dict(BIZ, default_markup_pct=30)))
    x = product(api, p['id'])
    assert x['suggested_price'] == 1300 and x['markup_used'] == 30 and x['margin_pct'] == 33.3  # price 1500 on cost 1000
    stock_in(api, p, 1001)  # a new cost: 1001 * 1.3 = 1301.3 -> 1305
    assert product(api, p['id'])['suggested_price'] == 1305
    ok(api('POST', '/api/inventory/products/%s/price' % p['id'], {'markupPct': 50}))  # this part has its own markup
    x = product(api, p['id'])
    assert x['markup_used'] == 50 and x['suggested_price'] == 1505 and x['markup_pct'] == 50
    ok(api('POST', '/api/inventory/products/%s/price' % p['id'], {'markupPct': ''}))  # back to the shop's
    assert product(api, p['id'])['markup_used'] == 30
    assert api('POST', '/api/inventory/products/%s/price' % p['id'], {'markupPct': 5000})[0] == 400
    assert api('PUT', '/api/workshop/settings', dict(BIZ, default_markup_pct=-1))[0] == 400


def test_nobody_without_cost_access_sees_cost_markup_or_suggestions(api):
    p = part(api)
    stock_in(api, p, 1000)
    ok(api('PUT', '/api/workshop/settings', dict(BIZ, default_markup_pct=30)))
    seen = product(api, p['id'], role='MECHANIC')
    assert not any(k in seen for k in ('last_cost', 'suggested_price', 'markup_used', 'margin_pct', 'markup_pct'))
    assert 'default_markup_pct' not in ok(api('GET', '/api/workshop/settings', role='MECHANIC'))
    assert ok(api('GET', '/api/workshop/settings'))['default_markup_pct'] == 30
    assert api('GET', '/api/inventory/price-review', role='ADMIN')[0] == 403 and api('GET', '/api/inventory/price-review', role='MECHANIC')[0] == 403
    assert api('POST', '/api/inventory/products/%s/price' % p['id'], {'price': 9}, role='MECHANIC')[0] == 403
    assert api('POST', '/api/inventory/products/%s/price' % p['id'], {'price': 1600}, role='ADMIN')[0] == 200  # an admin may set a price
    assert api('POST', '/api/inventory/products/%s/price' % p['id'], {'markupPct': 10}, role='ADMIN')[0] == 403  # but not see or set what it costs
    # saving settings without being able to see the markup does not wipe it
    ok(api('PUT', '/api/workshop/settings', {k: v for k, v in dict(BIZ).items()}))
    assert ok(api('GET', '/api/workshop/settings'))['default_markup_pct'] == 30


def test_the_price_review_lists_parts_whose_price_is_off_and_applies_in_one_go(api):
    ok(api('PUT', '/api/workshop/settings', dict(BIZ, default_markup_pct=30)))
    low = part(api)                                                     # price 1500, cost 1400 -> suggested 1820
    fine = part(api, partNumber='PN-2', sku='SH-2', name='Air filter', sellingPrice=1300)  # cost 1000 -> 1300, already right
    none = part(api, partNumber='PN-3', sku='SH-3', name='Plug')        # no cost known: left out
    stock_in(api, low, 1400); stock_in(api, fine, 1000)
    rev = ok(api('GET', '/api/inventory/price-review'))
    assert [r['id'] for r in rev['items']] == [low['id']] and rev['below'] == 1 and rev['items'][0]['suggested_price'] == 1820 and none
    done = ok(api('POST', '/api/inventory/price-review', {'items': [{'productId': low['id'], 'price': 1820}]}))
    assert done['updated'] == 1 and product(api, low['id'])['selling_price'] == 1820 and ok(api('GET', '/api/inventory/price-review'))['items'] == []
    assert api('POST', '/api/inventory/price-review', {'items': []})[0] == 400
    assert api('POST', '/api/inventory/price-review', {'items': [{'productId': low['id'], 'price': 1}, {'productId': low['id'], 'price': 2}]})[0] == 400
    assert api('POST', '/api/inventory/price-review', {'items': [{'productId': low['id'], 'price': 1820}]})[0] == 400  # nothing to change
    assert api('POST', '/api/inventory/price-review', {'items': [{'productId': low['id'], 'price': 1}]}, role='MECHANIC')[0] == 403


def test_old_jobs_keep_the_price_they_were_made_at(api):
    from test_shops import JOB
    p = part(api, openingQuantity=5)
    job = ok(api('POST', '/api/workshop/jobs', JOB))
    ok(api('POST', '/api/workshop/jobs/%s/stock' % job['id'], {'revision': job['revision'], 'productId': p['id'], 'quantity': 1, 'op': 'use'}))
    ok(api('POST', '/api/inventory/products/%s/price' % p['id'], {'price': 2000}))
    got = ok(api('GET', '/api/workshop/jobs/%s' % job['id']))
    assert got['parts'][0]['unit_price'] == 1500


def test_prices_are_per_shop(api):
    a = ok(api('POST', '/api/inventory/products', PART, shop='ganga'))
    ok(api('POST', '/api/inventory/products/%s/price' % a['id'], {'price': 99}, shop='ganga'))
    assert api('POST', '/api/inventory/products/%s/price' % a['id'], {'price': 5}, shop='other')[0] == 404
    assert api('GET', '/api/inventory/products/%s/price-history' % a['id'], shop='other')[0] == 404
    assert ok(api('GET', '/api/inventory/price-review', shop='other'))['items'] == []
