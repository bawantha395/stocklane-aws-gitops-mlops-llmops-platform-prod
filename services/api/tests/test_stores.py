"""Shelves (racks with levels) and categories: the owner makes the lists once, item forms pick from them."""
from test_stock_count import ok

BODY = {'partNumber': 'PN-9', 'sku': 'ST-9', 'name': 'Brake pad', 'category': 'Brakes', 'brand': 'Toyota', 'unit': 'UNIT',
        'sellingPrice': 5000, 'reorderLevel': 2, 'openingQuantity': 4, 'location': 'Rack 1-B'}


def lists(api):
    return ok(api('PUT', '/api/inventory/stores', {'racks': [{'name': 'Rack 1', 'levels': ['A', 'B', 'C']}, {'name': 'Rack 2', 'levels': []}],
                                                   'categories': ['Brakes', 'Filters']}))


def test_no_lists_means_free_text_as_before(api):
    assert ok(api('GET', '/api/inventory/stores', role='MECHANIC')) == {'racks': [], 'categories': [], 'areas': [], 'shelves': [], 'revision': 0}
    assert ok(api('POST', '/api/inventory/products', BODY, role='MECHANIC'))['location'] == 'Rack 1-B'


def test_owner_makes_the_lists_and_everyone_reads_them(api):
    v = lists(api)
    assert v['shelves'] == ['Rack 1-A', 'Rack 1-B', 'Rack 1-C', 'Rack 2'] and v['categories'] == ['Brakes', 'Filters'] and v['revision'] == 1
    assert ok(api('GET', '/api/inventory/stores', role='MECHANIC'))['shelves'] == v['shelves']
    assert api('PUT', '/api/inventory/stores', {'racks': [], 'categories': []}, role='MECHANIC')[0] == 403
    assert api('PUT', '/api/inventory/stores', {'racks': [{'name': 'R'}, {'name': 'r'}]})[0] == 400  # a name twice
    assert api('PUT', '/api/inventory/stores', {'racks': [{'name': 'R', 'levels': ['A', 'a']}]})[0] == 400


def test_a_part_must_use_a_listed_shelf_and_category(api):
    lists(api)
    made = ok(api('POST', '/api/inventory/products', dict(BODY, location='rack 1-b', category='brakes'), role='MECHANIC'))
    assert made['location'] == 'Rack 1-B' and made['category'] == 'Brakes'  # written the way the list spells it
    assert api('POST', '/api/inventory/products', dict(BODY, sku='ST-10', partNumber='PN-10', location='Rack 9-Z'), role='MECHANIC')[0] == 400
    assert api('POST', '/api/inventory/products', dict(BODY, sku='ST-11', partNumber='PN-11', category='Gadgets'), role='MECHANIC')[0] == 400
    # no shelf yet is fine: "Shelf not set"
    assert ok(api('POST', '/api/inventory/products', dict(BODY, sku='ST-12', partNumber='PN-12', location=''), role='MECHANIC'))['location'] == ''


def test_owner_adds_one_rack_level_or_category_from_the_item_form(api):
    lists(api)
    assert api('POST', '/api/inventory/stores/add', {'kind': 'level', 'rack': 'Rack 2', 'level': 'A'}, role='MECHANIC')[0] == 403
    v = ok(api('POST', '/api/inventory/stores/add', {'kind': 'level', 'rack': 'Rack 2', 'level': 'A'}))
    assert 'Rack 2-A' in v['shelves'] and 'Rack 2' not in v['shelves']
    v = ok(api('POST', '/api/inventory/stores/add', {'kind': 'rack', 'name': 'Rack 3', 'levels': ['A', 'B']}))
    assert 'Rack 3-B' in v['shelves']
    v = ok(api('POST', '/api/inventory/stores/add', {'kind': 'category', 'name': 'Batteries'}))
    assert 'Batteries' in v['categories']
    assert api('POST', '/api/inventory/stores/add', {'kind': 'category', 'name': 'batteries'})[0] == 400  # already there
    assert ok(api('POST', '/api/inventory/products', dict(BODY, location='Rack 3-B', category='Batteries'), role='MECHANIC'))['location'] == 'Rack 3-B'


def test_a_shelf_or_category_in_use_cannot_be_removed(api):
    lists(api)
    p = ok(api('POST', '/api/inventory/products', BODY, role='MECHANIC'))
    code, body = api('PUT', '/api/inventory/stores', {'racks': [{'name': 'Rack 1', 'levels': ['A', 'C']}], 'categories': ['Brakes']})
    assert code == 409 and 'Rack 1-B' in body['message']
    code, body = api('PUT', '/api/inventory/stores', {'racks': [{'name': 'Rack 1', 'levels': ['A', 'B', 'C']}], 'categories': ['Filters']})
    assert code == 409 and 'Brakes' in body['message']
    # an unused one can go
    v = ok(api('PUT', '/api/inventory/stores', {'racks': [{'name': 'Rack 1', 'levels': ['A', 'B']}], 'categories': ['Brakes', 'Filters']}))
    assert v['shelves'] == ['Rack 1-A', 'Rack 1-B']
    # moving the part first frees the shelf; the owner may also edit it to a listed shelf
    edited = ok(api('PATCH', '/api/inventory/products/%s' % p['id'], {'name': 'Brake pad', 'category': 'Brakes', 'brand': 'Toyota', 'partNumber': 'PN-9', 'location': 'Rack 1-A', 'reorderLevel': 2}))
    assert edited['location'] == 'Rack 1-A'
    assert api('PATCH', '/api/inventory/products/%s' % p['id'], {'name': 'Brake pad', 'category': 'Brakes', 'brand': 'Toyota', 'partNumber': 'PN-9', 'location': 'Nowhere', 'reorderLevel': 2})[0] == 400
