"""Stock count corrections: the shelf count moves the books, stays in the ledger, and is never counted as demand."""
from datetime import date, timedelta
from decimal import Decimal

from stocklane_api import inventory


def ok(res):
    status, body = res
    assert status == 200, body
    return body


def product(api, qty=10):
    return ok(api('POST', '/api/inventory/products', {'partNumber': 'PN-1', 'sku': 'OF-1', 'name': 'Oil filter', 'category': 'Filters', 'brand': 'Toyota', 'unit': 'UNIT',
                                                      'sellingPrice': 1800, 'reorderLevel': 3, 'openingQuantity': qty, 'location': 'A3'}))


def stock(api, pid):
    return next(p for p in ok(api('GET', '/api/inventory/products', role='MECHANIC')) if p['id'] == pid)['quantity']


def test_count_down_and_up(api):
    p = product(api, 10)
    down = ok(api('POST', '/api/inventory/movements', {'kind': 'COUNT', 'productId': p['id'], 'quantity': 7}))
    assert down['kind'] == 'COUNT_OUT' and down['quantity'] == 3 and down['balance'] == 7 and down['note'] == 'Count correction'
    assert stock(api, p['id']) == 7
    up = ok(api('POST', '/api/inventory/movements', {'kind': 'COUNT', 'productId': p['id'], 'quantity': 12, 'note': 'Found a box'}))
    assert up['kind'] == 'COUNT_IN' and up['quantity'] == 5 and stock(api, p['id']) == 12
    kinds = [m['kind'] for m in ok(api('GET', '/api/inventory/movements', role='MECHANIC'))]
    assert 'COUNT_IN' in kinds and 'COUNT_OUT' in kinds


def test_count_rules(api):
    p = product(api, 10)
    assert api('POST', '/api/inventory/movements', {'kind': 'COUNT', 'productId': p['id'], 'quantity': 10})[0] == 400  # nothing to correct
    assert api('POST', '/api/inventory/movements', {'kind': 'COUNT', 'productId': p['id'], 'quantity': -1})[0] == 400
    assert api('POST', '/api/inventory/movements', {'kind': 'COUNT', 'productId': p['id'], 'quantity': 2.5})[0] == 400  # sealed units are whole
    assert api('POST', '/api/inventory/movements', {'kind': 'COUNT', 'productId': p['id'], 'quantity': 4}, role='MECHANIC')[0] == 403  # owner only
    assert ok(api('POST', '/api/inventory/movements', {'kind': 'COUNT', 'productId': p['id'], 'quantity': 0}))['balance'] == 0  # an empty shelf is a valid count
    assert api('POST', '/api/inventory/movements', {'kind': 'STOCK_OUT', 'productId': p['id'], 'quantity': 0}, role='MECHANIC')[0] == 400  # normal moves still need a positive quantity


def test_books_stay_balanced_and_demand_is_untouched(api):
    p = product(api, 10)
    ok(api('POST', '/api/inventory/movements', {'kind': 'STOCK_OUT', 'productId': p['id'], 'quantity': 2}, role='MECHANIC'))
    ok(api('POST', '/api/inventory/movements', {'kind': 'COUNT', 'productId': p['id'], 'quantity': 5}))  # 8 -> 5
    ok(api('POST', '/api/inventory/movements', {'kind': 'COUNT', 'productId': p['id'], 'quantity': 6}))  # 5 -> 6
    row = next(r for r in inventory.analysis((date.today() - timedelta(days=1)).isoformat() + 'T00:00:00+05:30', (date.today() + timedelta(days=2)).isoformat() + 'T00:00:00+05:30')['rows'] if r['id'] == p['id'])
    assert row['available_now'] == 6
    assert row['taken_quantity'] == 2  # only the real stock-out is demand
    assert row['adjusted_quantity'] == Decimal(-2)
    assert row['opening_quantity'] + row['added_quantity'] - row['taken_quantity'] + row['adjusted_quantity'] == row['closing_quantity'] == 6
    # the forecast export refuses to run when the ledger and the shelf quantity differ, so they must still agree
    from stocklane_api.core import query
    days = [d for d in query('DAY') if d['product_id'] == p['id']]
    assert sum(d['added'] - d['taken'] + d.get('adjusted', 0) for d in days) == 6
