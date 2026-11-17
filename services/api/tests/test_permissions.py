"""Roles and permissions: every role's defaults, the owner's switches, and that cost and sales stay with those allowed."""
import json

from test_stock_count import ok
from test_shops import JOB, PART

RECEIPT = lambda p: {'productId': p['id'], 'kind': 'RECEIPT', 'quantity': 2, 'unitCost': 900, 'supplier': 'ABC'}


def test_defaults_of_each_role(api):
    p = ok(api('POST', '/api/inventory/products', PART))
    # mechanic: exactly what a mechanic could do before roles existed
    assert api('POST', '/api/inventory/movements', RECEIPT(p), role='MECHANIC')[0] == 200
    assert api('POST', '/api/workshop/jobs', JOB, role='MECHANIC')[0] == 200
    assert api('PATCH', '/api/inventory/products/%s' % p['id'], {}, role='MECHANIC')[0] == 403
    assert api('GET', '/api/workshop/report', role='MECHANIC')[0] == 403
    assert api('POST', '/api/inventory/movements', {'productId': p['id'], 'kind': 'COUNT', 'quantity': 5}, role='MECHANIC')[0] == 403
    # store keeper: the store room, not the bills
    assert api('POST', '/api/inventory/movements', RECEIPT(p), role='STOREKEEPER')[0] == 200
    assert api('POST', '/api/inventory/products', dict(PART, sku='SK-2', partNumber='P-2'), role='STOREKEEPER')[0] == 200
    assert api('GET', '/api/workshop/jobs', role='STOREKEEPER')[0] == 200  # needs the job list to hand parts to a job
    assert api('POST', '/api/workshop/jobs', dict(JOB, registration='CAB-2222'), role='STOREKEEPER')[0] == 403
    assert api('GET', '/api/workshop/invoices', role='STOREKEEPER')[0] == 403
    # admin: both, plus editing parts and the lists; never the money or the settings
    assert api('POST', '/api/workshop/jobs', dict(JOB, registration='CAB-3333'), role='ADMIN')[0] == 200
    assert api('POST', '/api/inventory/products/%s/archive' % p['id'], {'archived': False}, role='ADMIN')[0] == 200
    assert api('PUT', '/api/inventory/stores', {'racks': [], 'categories': ['Filters']}, role='ADMIN')[0] == 200
    assert api('GET', '/api/workshop/report', role='ADMIN')[0] == 403
    assert api('PUT', '/api/workshop/settings', {}, role='ADMIN')[0] == 403
    assert api('GET', '/api/workshop/permissions', role='ADMIN')[0] == 403
    # no role at all
    assert api('GET', '/api/inventory/products', role='NOBODY')[0] == 403
    assert api('GET', '/api/workshop/jobs', role='NOBODY')[0] == 403


def test_owner_switches_permissions_on_and_off(api):
    p = ok(api('POST', '/api/inventory/products', PART))
    v = ok(api('GET', '/api/workshop/permissions'))
    assert 'stock_in' in v['roles']['MECHANIC'] and {x['key'] for x in v['permissions']} >= {'see_cost', 'settings'}
    roles = dict(v['roles'], MECHANIC=[k for k in v['roles']['MECHANIC'] if k not in ('stock_in', 'stock_out', 'item_add')] + ['item_edit'])
    ok(api('PUT', '/api/workshop/permissions', {'roles': roles}))
    assert api('POST', '/api/inventory/movements', RECEIPT(p), role='MECHANIC')[0] == 403  # taken away: at once
    assert api('POST', '/api/inventory/products', dict(PART, sku='SK-9', partNumber='P-9'), role='MECHANIC')[0] == 403
    assert api('POST', '/api/inventory/products/%s/archive' % p['id'], {'archived': False}, role='MECHANIC')[0] == 200  # given
    assert sorted(ok(api('GET', '/api/inventory/session', role='MECHANIC'))['permissions']) == sorted(roles['MECHANIC'])
    # a person in two roles has both sets; the owner always has everything and cannot be switched off
    assert api('POST', '/api/inventory/movements', RECEIPT(p), role='MECHANIC STOREKEEPER')[0] == 200
    assert api('PUT', '/api/workshop/permissions', {'roles': {'OWNER': []}})[0] == 200 and api('GET', '/api/workshop/report')[0] == 200
    assert len(ok(api('GET', '/api/inventory/session'))['permissions']) == len(v['permissions'])
    # rubbish is refused, only the owner may change the table, and reset brings the defaults back
    assert api('PUT', '/api/workshop/permissions', {'roles': {'MECHANIC': ['fly']}})[0] == 400
    assert api('PUT', '/api/workshop/permissions', {'roles': roles}, role='ADMIN')[0] == 403
    back = ok(api('PUT', '/api/workshop/permissions', {'reset': True}))
    assert back['roles'] == back['defaults'] and api('POST', '/api/inventory/movements', RECEIPT(p), role='MECHANIC')[0] == 200
    # another shop keeps its own table
    ok(api('PUT', '/api/workshop/permissions', {'roles': dict(v['roles'], MECHANIC=[])}))
    assert api('GET', '/api/workshop/jobs', role='MECHANIC')[0] == 403 and api('GET', '/api/workshop/jobs', role='MECHANIC', shop='other')[0] == 200


def money_words(value, path=''):
    hits = set()
    if isinstance(value, dict):
        for k, v in value.items():
            if any(w in k.lower() for w in ('cost', 'margin', 'profit', 'outside_shop')):
                hits.add(path + '.' + k)
            hits |= money_words(v, path + '.' + k)
    elif isinstance(value, list):
        for v in value:
            hits |= money_words(v, path + '[]')
    return hits


def test_cost_and_sales_only_for_those_allowed(api):
    p = ok(api('POST', '/api/inventory/products', PART))
    ok(api('POST', '/api/inventory/movements', RECEIPT(p)))
    job = ok(api('POST', '/api/workshop/jobs', JOB))
    ok(api('PATCH', '/api/workshop/jobs/%s' % job['id'], {'revision': job['revision'], 'discount': 0, 'labour': [{'description': 'Service', 'amount': 2500}],
                                                          'parts': [{'name': 'Bulb', 'quantity': 1, 'unit_price': 500, 'outside': True, 'outside_cost': 300, 'outside_shop': 'Kade'}]}))
    ok(api('POST', '/api/workshop/jobs/%s/invoice' % job['id'], {'revision': job['revision'] + 1}))
    reads = ['/api/inventory/products', '/api/inventory/catalogue', '/api/inventory/movements', '/api/workshop/jobs', '/api/workshop/jobs/%s' % job['id'],
             '/api/workshop/invoices', '/api/workshop/dashboard', '/api/workshop/vehicles']
    for role in ('MECHANIC', 'ADMIN', 'STOREKEEPER'):
        for path in reads:
            code, body = api('GET', path, role=role)
            assert code in (200, 403) and not money_words(body), (role, path, money_words(body))
        code, dash = api('GET', '/api/workshop/dashboard', role=role)
        assert dash['sales_hidden'] and dash['today']['billed'] == 0 and dash['month']['received'] == 0
    owner = ok(api('GET', '/api/workshop/dashboard'))
    assert owner['today']['billed'] > 0 and 'sales_hidden' not in owner
    assert money_words(ok(api('GET', '/api/inventory/movements')))
    # the owner lets the admin see cost and sales
    v = ok(api('GET', '/api/workshop/permissions'))
    ok(api('PUT', '/api/workshop/permissions', {'roles': dict(v['roles'], ADMIN=v['roles']['ADMIN'] + ['see_cost', 'see_sales'])}))
    assert money_words(ok(api('GET', '/api/inventory/movements', role='ADMIN')))
    j2 = ok(api('POST', '/api/workshop/jobs', dict(JOB, registration='CAB-7777')))
    ok(api('PATCH', '/api/workshop/jobs/%s' % j2['id'], {'revision': j2['revision'], 'parts': [{'name': 'Bulb', 'quantity': 1, 'unit_price': 500, 'outside': True, 'outside_cost': 300, 'outside_shop': 'Kade'}]}))
    assert 'outside_cost' in json.dumps(ok(api('GET', '/api/workshop/jobs/%s' % j2['id'], role='ADMIN')))
    assert 'outside_cost' not in json.dumps(ok(api('GET', '/api/workshop/jobs/%s' % j2['id'], role='MECHANIC')))
    assert ok(api('GET', '/api/workshop/dashboard', role='ADMIN'))['today']['billed'] > 0
    assert not money_words(ok(api('GET', '/api/inventory/movements', role='MECHANIC')))  # still not the mechanic


def test_every_route_names_a_permission_or_is_a_plain_read(api):
    """A new route cannot be added without deciding who may use it."""
    from stocklane_api import handler, perms
    for verb, pattern, roles, *_ in handler.ROUTES:
        if isinstance(roles, handler.P):
            assert roles in perms.KEYS, pattern.pattern
        elif roles == handler.STAFF:
            assert verb == 'GET' or pattern.pattern in ('^/api/inventory/movements$', '^/api/inventory/documents$', '^/api/workshop/photos$'), pattern.pattern
        elif isinstance(roles, handler.Open):
            assert verb in ('GET', 'POST') and pattern.pattern.startswith('^/api/public/track/'), pattern.pattern  # the customer's own link: only these are open
        else:
            assert roles in (None, handler.OWNER, handler.PLATFORM), pattern.pattern
