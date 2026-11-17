"""Many shops in one table: a shop can never read, change or collide with another shop's rows."""
import boto3
from test_stock_count import ok

PART = {'partNumber': 'PN-1', 'sku': 'SH-1', 'name': 'Oil filter', 'category': 'Filters', 'brand': 'Toyota', 'unit': 'UNIT',
        'sellingPrice': 1500, 'reorderLevel': 2, 'openingQuantity': 3, 'location': ''}
JOB = {'registration': 'CAB-1234', 'customer': 'Nimal Perera', 'phone': '0771234567', 'vehicle': 'Toyota Prius', 'summary': 'Service', 'mechanic': 'Kamal'}


def test_each_shop_sees_only_its_own_parts(api):
    a = ok(api('POST', '/api/inventory/products', PART, shop='ganga'))
    assert [p['sku'] for p in ok(api('GET', '/api/inventory/products', shop='ganga'))] == ['SH-1']
    assert ok(api('GET', '/api/inventory/products', shop='other')) == []
    assert ok(api('GET', '/api/inventory/catalogue', shop='other')) == []  # the 30 s catalogue cache is per shop too
    assert ok(api('GET', '/api/inventory/movements', shop='other')) == []
    # the same SKU, part number and barcode are free in another shop
    b = ok(api('POST', '/api/inventory/products', PART, shop='other'))
    assert b['id'] != a['id']
    assert api('POST', '/api/inventory/products', PART, shop='ganga')[0] == 409  # still taken inside the shop


def test_another_shops_ids_are_not_found(api):
    a = ok(api('POST', '/api/inventory/products', PART, shop='ganga'))
    body = {'productId': a['id'], 'kind': 'RECEIPT', 'quantity': 5, 'unitCost': 900}
    assert api('POST', '/api/inventory/movements', body, shop='other')[0] == 404
    assert api('PATCH', '/api/inventory/products/%s' % a['id'], dict(PART, reorderLevel=1), shop='other')[0] == 404
    assert api('POST', '/api/inventory/products/%s/archive' % a['id'], {'archived': True}, shop='other')[0] == 404
    job = ok(api('POST', '/api/workshop/jobs', JOB, shop='ganga'))
    assert api('GET', '/api/workshop/jobs/%s' % job['id'], shop='other')[0] == 404
    assert ok(api('GET', '/api/workshop/jobs', shop='other')) == []
    assert ok(api('GET', '/api/workshop/vehicles', shop='other')) == []
    # and the stock in the first shop did not move
    assert ok(api('GET', '/api/inventory/products', shop='ganga'))[0]['quantity'] == 3


def test_numbers_and_settings_run_per_shop(api):
    j1, j2 = ok(api('POST', '/api/workshop/jobs', JOB, shop='ganga')), ok(api('POST', '/api/workshop/jobs', JOB, shop='other'))
    assert j1['job_no'] == j2['job_no']  # each shop starts its own job numbers
    for shop in ('ganga', 'other'):
        p = ok(api('POST', '/api/inventory/products', PART, shop=shop))
        m = ok(api('POST', '/api/inventory/movements', {'productId': p['id'], 'kind': 'RECEIPT', 'quantity': 1, 'unitCost': 900}, shop=shop))
        assert m['doc_no'].endswith('0001'), m['doc_no']  # each shop's first GRN
    s = ok(api('GET', '/api/workshop/settings', shop='ganga'))
    ok(api('PUT', '/api/workshop/settings', dict(s, name='Ganga Motors'), shop='ganga'))
    assert ok(api('GET', '/api/workshop/settings', shop='ganga'))['name'] == 'Ganga Motors'
    assert ok(api('GET', '/api/workshop/settings', shop='other'))['name'] != 'Ganga Motors'
    ok(api('PUT', '/api/inventory/stores', {'racks': [{'name': 'Rack 1', 'levels': ['A']}], 'categories': ['Filters']}, shop='ganga'))
    assert ok(api('GET', '/api/inventory/stores', shop='other'))['shelves'] == []


def test_a_request_key_is_never_replayed_into_another_shop(api):
    key = 'same-key-0000000000000001'
    a = ok(api('POST', '/api/inventory/products', PART, shop='ganga', key=key))
    b = ok(api('POST', '/api/inventory/products', PART, shop='other', key=key))
    assert a['id'] != b['id'] and len(ok(api('GET', '/api/inventory/products', shop='other'))) == 1


def test_which_shop_a_sign_in_belongs_to(api, monkeypatch):
    assert api('GET', '/api/inventory/products', role='OWNER SHOP_ganga SHOP_other')[0] == 403  # never two shops
    assert api('GET', '/api/inventory/products', role='OWNER SHOP_Bad_Name!')[0] == 403
    ok(api('POST', '/api/inventory/products', PART))  # no shop group: this deployment's one default shop
    assert len(ok(api('GET', '/api/inventory/products', shop='main'))) == 1
    monkeypatch.setenv('REQUIRE_SHOP', '1')  # a shared deployment refuses a sign-in with no shop
    assert api('GET', '/api/inventory/products')[0] == 403
    assert api('GET', '/api/inventory/products', shop='ganga')[0] == 200


def test_every_row_is_stored_under_its_shop(api):
    p = ok(api('POST', '/api/inventory/products', PART, shop='ganga'))
    ok(api('POST', '/api/inventory/movements', {'productId': p['id'], 'kind': 'RECEIPT', 'quantity': 2, 'unitCost': 900}, shop='ganga'))
    ok(api('POST', '/api/workshop/jobs', JOB, shop='ganga'))
    ok(api('GET', '/api/inventory/session', shop='ganga', query={'email': 'owner@example.com'}))
    ok(api('POST', '/api/inventory/people', {'name': 'Sunil'}, shop='ganga'))
    rows = boto3.resource('dynamodb').Table('test-table').scan()['Items']
    assert rows and all(r['pk'].startswith('T#ganga#') for r in rows), sorted({r['pk'] for r in rows if not r['pk'].startswith('T#ganga#')})
