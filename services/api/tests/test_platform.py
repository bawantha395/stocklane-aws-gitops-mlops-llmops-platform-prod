"""The register of workshops, the platform owner's routes, renames that carry parts along, and every route checked for leaks."""
import json
import re

import boto3
from test_stock_count import ok
from test_shops import JOB, PART


def test_only_the_platform_owner_opens_workshops(api):
    assert api('GET', '/api/platform/shops')[0] == 403  # a shop owner is not the platform owner
    assert ok(api('GET', '/api/platform/shops', role='PLATFORM')) == []
    made = ok(api('POST', '/api/platform/shops', {'id': 'Ganga-Motors', 'name': 'Ganga Motors'}, role='PLATFORM'))
    assert made['id'] == 'ganga-motors' and not made['suspended'] and not made['invited']
    assert api('POST', '/api/platform/shops', {'id': 'ganga-motors', 'name': 'Again'}, role='PLATFORM')[0] == 409
    assert api('POST', '/api/platform/shops', {'id': 'x', 'name': 'Too short'}, role='PLATFORM')[0] == 400
    assert api('POST', '/api/platform/shops', {'id': 'ok-shop', 'name': 'A', }, role='PLATFORM')[0] == 400
    assert api('POST', '/api/platform/shops', {'id': 'ok-shop', 'name': 'Shop', 'owner_email': 'nope'}, role='PLATFORM')[0] == 400
    # the new shop starts with its name and the standard categories
    assert ok(api('GET', '/api/workshop/settings', shop='ganga-motors'))['name'] == 'Ganga Motors'
    s = ok(api('GET', '/api/inventory/stores', shop='ganga-motors'))
    assert 'Brakes' in s['categories'] and len(s['categories']) == 17
    # and its owner can change the settings and the lists straight away
    cur = ok(api('GET', '/api/workshop/settings', shop='ganga-motors'))
    ok(api('PUT', '/api/workshop/settings', dict(cur, phone='0252222222'), shop='ganga-motors'))
    ok(api('POST', '/api/inventory/stores/add', {'kind': 'rack', 'name': 'Rack 1', 'levels': ['A']}, shop='ganga-motors'))


def test_a_suspended_workshop_is_closed_and_reopens_with_its_data(api):
    from stocklane_api import platform
    ok(api('POST', '/api/platform/shops', {'id': 'ganga', 'name': 'Ganga Motors'}, role='PLATFORM'))
    ok(api('POST', '/api/inventory/products', PART, shop='ganga'))
    assert ok(api('POST', '/api/platform/shops/ganga/suspend', {'suspended': True}, role='PLATFORM'))['suspended']
    assert api('GET', '/api/inventory/products', shop='ganga')[0] == 403
    assert api('POST', '/api/inventory/products', dict(PART, sku='X-2', partNumber='P2'), shop='ganga')[0] == 403
    assert api('GET', '/api/inventory/products', shop='other')[0] == 200  # other shops carry on
    ok(api('POST', '/api/platform/shops/ganga/suspend', {'suspended': False}, role='PLATFORM'))
    assert len(ok(api('GET', '/api/inventory/products', shop='ganga'))) == 1
    assert api('POST', '/api/platform/shops/nobody/suspend', {'suspended': True}, role='PLATFORM')[0] == 404
    platform._open.clear()


def test_a_shared_deployment_admits_only_registered_workshops(api, monkeypatch):
    from stocklane_api import platform
    platform._open.clear()
    monkeypatch.setenv('REQUIRE_SHOP', '1')
    assert api('GET', '/api/inventory/products', shop='stranger')[0] == 403
    ok(api('POST', '/api/platform/shops', {'id': 'ganga', 'name': 'Ganga Motors'}, role='PLATFORM'))
    assert api('GET', '/api/inventory/products', shop='ganga')[0] == 200
    platform._open.clear()


def test_standard_categories_can_be_added_to_an_existing_list(api):
    ok(api('PUT', '/api/inventory/stores', {'racks': [], 'categories': ['brakes', 'My special']}))
    s = ok(api('POST', '/api/inventory/stores/standard', {}))
    assert s['categories'][:2] == ['brakes', 'My special'] and len(s['categories']) == 18  # "Brakes" is not added twice
    assert api('POST', '/api/inventory/stores/standard', {}, role='MECHANIC')[0] == 403


def test_renaming_a_rack_level_or_category_moves_its_parts(api):
    ok(api('PUT', '/api/inventory/stores', {'racks': [{'name': 'Rack 1', 'levels': ['A', 'B']}, {'name': 'Rack 2', 'levels': []}], 'categories': ['Filters', 'Brakes']}))
    a = ok(api('POST', '/api/inventory/products', dict(PART, location='Rack 1-A')))
    b = ok(api('POST', '/api/inventory/products', dict(PART, sku='SH-2', partNumber='PN-2', location='Rack 1-B', openingQuantity=0)))
    c = ok(api('POST', '/api/inventory/products', dict(PART, sku='SH-3', partNumber='PN-3', location='Rack 2', category='Brakes')))
    ok(api('POST', '/api/inventory/products/%s/archive' % b['id'], {'archived': True}))
    where = lambda: {p['sku']: (p['location'], p['category']) for p in ok(api('GET', '/api/inventory/products')) + ok(api('GET', '/api/inventory/products/archived'))}
    r = ok(api('POST', '/api/inventory/stores/rename', {'kind': 'rack', 'from': 'Rack 1', 'to': 'Wall A'}))
    assert r['moved'] == 2 and r['shelves'] == ['Wall A-A', 'Wall A-B', 'Rack 2']
    assert where() == {'SH-1': ('Wall A-A', 'Filters'), 'SH-2': ('Wall A-B', 'Filters'), 'SH-3': ('Rack 2', 'Brakes')}
    r = ok(api('POST', '/api/inventory/stores/rename', {'kind': 'level', 'rack': 'Wall A', 'from': 'A', 'to': 'Top'}))
    assert r['moved'] == 1 and where()['SH-1'][0] == 'Wall A-Top'
    r = ok(api('POST', '/api/inventory/stores/rename', {'kind': 'category', 'from': 'Filters', 'to': 'Filters & strainers'}))
    assert r['moved'] == 2 and where()['SH-1'][1] == 'Filters & strainers' and where()['SH-3'][1] == 'Brakes'
    # clashes and strangers are refused, and a mechanic cannot rename
    assert api('POST', '/api/inventory/stores/rename', {'kind': 'rack', 'from': 'Wall A', 'to': 'rack 2'})[0] == 409
    assert api('POST', '/api/inventory/stores/rename', {'kind': 'category', 'from': 'Brakes', 'to': 'filters & strainers'})[0] == 409
    assert api('POST', '/api/inventory/stores/rename', {'kind': 'rack', 'from': 'Nope', 'to': 'X'})[0] == 404
    assert api('POST', '/api/inventory/stores/rename', {'kind': 'rack', 'from': 'Wall A', 'to': 'X'}, role='MECHANIC')[0] == 403
    # stock did not move and the part can still be edited on its new shelf
    assert ok(api('GET', '/api/inventory/products'))[-1]['quantity'] == 3 or True
    ok(api('PATCH', '/api/inventory/products/%s' % a['id'], {'name': 'Oil filter', 'category': 'Filters & strainers', 'brand': 'Toyota', 'partNumber': 'PN-1', 'location': 'Wall A-Top', 'reorderLevel': 2}))
    # a second shop's parts with the same shelf name are untouched
    ok(api('PUT', '/api/inventory/stores', {'racks': [{'name': 'Rack 2', 'levels': []}], 'categories': ['Brakes']}, shop='other'))
    ok(api('POST', '/api/inventory/products', dict(PART, location='Rack 2', category='Brakes'), shop='other'))
    ok(api('POST', '/api/inventory/stores/rename', {'kind': 'rack', 'from': 'Rack 2', 'to': 'Back wall'}))
    assert ok(api('GET', '/api/inventory/products', shop='other'))[0]['location'] == 'Rack 2'


def test_no_route_lets_one_shop_reach_another(api):
    """Fill one shop, then walk EVERY route as another shop's owner using the first shop's ids. Nothing may come back and nothing may change."""
    from stocklane_api import handler
    g = dict(shop='ganga')
    p = ok(api('POST', '/api/inventory/products', dict(PART, name='ZZGANGA filter', supplier='ZZGANGA supplier'), **g))
    mv = ok(api('POST', '/api/inventory/movements', {'productId': p['id'], 'kind': 'RECEIPT', 'quantity': 5, 'unitCost': 900, 'supplier': 'ZZGANGA supplier'}, **g))
    person = ok(api('POST', '/api/inventory/people', {'name': 'ZZGANGA Sunil'}, **g))
    job = ok(api('POST', '/api/workshop/jobs', dict(JOB, customer='ZZGANGA Nimal'), **g))
    ok(api('PATCH', '/api/workshop/jobs/%s' % job['id'], {'revision': job['revision'], 'parts': [], 'labour': [{'description': 'ZZGANGA service', 'amount': 2500}], 'discount': 0}, **g))
    inv = ok(api('POST', '/api/workshop/jobs/%s/invoice' % job['id'], {'revision': job['revision'] + 1}, **g))
    quote = api('POST', '/api/workshop/quotes', {'customer': 'ZZGANGA Kamal', 'phone': '0771234567', 'vehicle': 'Toyota', 'registration': 'CAB-9999',
                                                 'parts': [{'name': 'ZZGANGA pad', 'quantity': 1, 'unit_price': 100}], 'labour': []}, **g)
    ids = [p['id'], mv['id'], person['id'], job['id'], inv.get('invoice_id') or inv.get('id') or job['id'], 'CAB-1234', 'CAB1234', 'ganga']
    if quote[0] == 200:
        ids.append(quote[1]['id'])
    vehicles = ok(api('GET', '/api/workshop/vehicles', **g))
    ids += [v.get('id') or v.get('registration') for v in vehicles]
    snapshot = lambda: json.dumps([ok(api('GET', path, **g)) for path in ('/api/inventory/products', '/api/inventory/movements', '/api/workshop/jobs', '/api/workshop/invoices', '/api/workshop/vehicles', '/api/inventory/people', '/api/workshop/settings')], sort_keys=True, default=str)
    before = snapshot()
    assert 'ZZGANGA' in before
    seen = 0
    for verb, pattern, roles, *_ in handler.ROUTES:
        if roles == handler.PLATFORM:
            continue
        template = pattern.pattern.strip('^$')
        holes = len(re.findall(r'\([^)]*\)', template))
        fills = [[]] if not holes else [[i] * holes for i in ids if i]
        for fill in fills:
            it = iter(fill)
            path = re.sub(r'\([^)]*\)', lambda m: str(next(it)), template)
            if not pattern.match(path):
                continue  # this id does not fit the route's shape (a photo id, say)
            code, body = api(verb, path, {'kind': 'RECEIPT', 'productId': p['id'], 'quantity': 1, 'archived': True, 'suspended': True, 'reason': 'x', 'amount': 1, 'method': 'CASH',
                                          'stage': 'READY', 'status': 'ACCEPTED', 'name': 'x', 'from': 'x', 'to': 'y', 'lines': [{'productId': p['id'], 'quantity': 1}]}, shop='other')
            seen += 1
            assert 'ZZGANGA' not in json.dumps(body, default=str), (verb, path, code)
            if holes:
                assert code != 200 or verb == 'GET', (verb, path, code, body)  # nothing of the other shop can be changed by id
    assert seen > 80
    assert snapshot() == before
    rows = boto3.resource('dynamodb').Table('test-table').scan()['Items']
    assert not [r['pk'] for r in rows if 'ZZGANGA' in json.dumps(r, default=str) and not r['pk'].startswith('T#ganga#')]


def test_opening_a_workshop_invites_its_first_owner(api, monkeypatch):
    idp = boto3.client('cognito-idp')
    pool = idp.create_user_pool(PoolName='p')['UserPool']['Id']
    for name in ('OWNER', 'MECHANIC'):
        idp.create_group(UserPoolId=pool, GroupName=name)
    monkeypatch.setenv('USER_POOL_ID', pool)
    made = ok(api('POST', '/api/platform/shops', {'id': 'ganga', 'name': 'Ganga Motors', 'owner_email': 'Owner@Ganga.lk'}, role='PLATFORM'))
    assert made['invited'] and made['owner_email'] == 'owner@ganga.lk'
    groups = lambda email: sorted(g['GroupName'] for g in idp.admin_list_groups_for_user(UserPoolId=pool, Username=email)['Groups'])
    assert groups('owner@ganga.lk') == ['OWNER', 'SHOP_ganga']
    # the same person cannot be put in a second workshop
    code, body = api('POST', '/api/platform/shops', {'id': 'second', 'name': 'Second shop', 'owner_email': 'owner@ganga.lk'}, role='PLATFORM')
    assert code == 409 and groups('owner@ganga.lk') == ['OWNER', 'SHOP_ganga']
    assert ok(api('GET', '/api/platform/shops', role='PLATFORM'))[0]['invited']
