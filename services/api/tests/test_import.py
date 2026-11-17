from test_money_flow import ok

ROW = {'name': 'Oil filter', 'brand': 'Bosch', 'partNumber': 'OF-1', 'category': 'Filters', 'unit': 'UNIT', 'openingQuantity': 4, 'sellingPrice': 900, 'reorderLevel': 2}


def imp(api, rows, dry=False, **kw):
    return api('POST', '/api/inventory/products/import', {'rows': rows, 'dryRun': dry}, **kw)


def row(n, **extra):
    return {**ROW, 'name': 'Part %d' % n, 'partNumber': 'PN-%d' % n, **extra}


def test_dry_run_names_every_bad_row_and_writes_nothing(api):
    rows = [row(1), row(2, unit='BOX'), row(3, name=''), row(4, sku='DUP'), row(5, sku='DUP'), row(1)]
    r = ok(imp(api, rows, dry=True))
    assert r['rows'] == 6 and r['ok'] == 2
    bad = {e['row']: e['error'] for e in r['errors']}
    assert set(bad) == {2, 3, 5, 6} and 'Unit' in bad[2] and 'part number' in bad[6]
    assert ok(api('GET', '/api/inventory/products')) == []


def test_import_creates_parts_with_opening_stock_and_is_retry_safe(api):
    rows = [row(n) for n in range(1, 6)]
    r = ok(imp(api, rows, key='k-import-0000000001'))
    assert len(r['created']) == 5
    again = ok(imp(api, rows, key='k-import-0000000001'))
    assert len(again['created']) == 5
    prods = ok(api('GET', '/api/inventory/products'))
    assert len(prods) == 5 and all(p['quantity'] == 4 and p['selling_price'] == 900 for p in prods)
    # the catalogue's own duplicates are caught in the check and refused when imported
    chk = ok(imp(api, [row(1)], dry=True))
    assert chk['ok'] == 0 and chk['errors'][0]['row'] == 1
    code, _ = imp(api, [row(1)])
    assert code == 409


def test_import_is_all_or_none_and_limited_and_needs_permission(api):
    assert imp(api, [row(1), row(2, unit='BOX')])[0] == 400
    assert ok(api('GET', '/api/inventory/products')) == []
    assert imp(api, [row(n) for n in range(1, 12)])[0] == 400
    assert imp(api, [])[0] == 400
    assert imp(api, [row(9)], role='MECHANIC')[0] == 200  # mechanics may register parts (item_add)
    assert imp(api, [row(10)], role='STOREKEEPER')[0] == 200
