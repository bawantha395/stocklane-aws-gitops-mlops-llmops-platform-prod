"""Suppliers: one record each, picked on deliveries, parts and outside purchases; renames and closing never rewrite history."""
from test_money_flow import ok
from test_shops import JOB, PART


def supplier(api, name='Lanka Spares', **extra):
    return ok(api('POST', '/api/inventory/suppliers', dict({'name': name, 'phone': '011 234 5678', 'kind': 'MAIN', 'credit_days': 30}, **extra), role='ADMIN'))


def part(api, **extra):
    return ok(api('POST', '/api/inventory/products', dict(PART, **extra)))


def names(api, **kw):
    return [s['name'] for s in ok(api('GET', '/api/inventory/suppliers', **kw))]


def test_a_supplier_is_made_once_and_found(api):
    s = supplier(api)
    assert s['kind'] == 'MAIN' and s['credit_days'] == 30 and s['active'] and s['revision'] == 0
    code, body = api('POST', '/api/inventory/suppliers', {'name': 'lanka  spares'}, role='ADMIN')
    assert code == 409 and 'already exists' in body['message']  # same name, spaces and case ignored
    code, body = api('POST', '/api/inventory/suppliers', {'name': 'Other', 'phone': '+94112345678'}, role='ADMIN')
    assert code == 409 and 'Lanka Spares' in body['message']  # same number: ask first
    assert ok(api('POST', '/api/inventory/suppliers', {'name': 'Other', 'phone': '+94112345678', 'allow_same_phone': True}, role='ADMIN'))['name'] == 'Other'
    for bad in ({'name': ''}, {'name': 'X', 'kind': 'SHOP'}, {'name': 'X', 'credit_days': 400}, {'name': 'X', 'credit_days': 1.5}, {'name': 'X', 'phone': '123'}):
        assert api('POST', '/api/inventory/suppliers', bad, role='ADMIN')[0] == 400, bad
    ok(api('POST', '/api/inventory/suppliers', {'name': 'Kade Mudalali', 'kind': 'LOCAL'}, role='ADMIN'))
    assert names(api, query={'search': 'lanka'}) == ['Lanka Spares'] and names(api, query={'search': '234 56'}) == ['Lanka Spares', 'Other']
    assert names(api, query={'kind': 'LOCAL'}) == ['Kade Mudalali']


def test_a_delivery_carries_the_supplier_and_the_part_remembers_it(api):
    s = supplier(api)
    p = part(api)
    mv = ok(api('POST', '/api/inventory/movements', {'productId': p['id'], 'kind': 'RECEIPT', 'quantity': 4, 'unitCost': 900, 'supplierId': s['id'], 'reference': 'DN-1'}))
    assert mv['supplier'] == 'Lanka Spares' and mv['supplier_id'] == s['id']
    mine = ok(api('GET', '/api/inventory/products'))[0]
    assert mine['supplier'] == 'Lanka Spares' and mine['supplier_id'] == s['id']  # the first supplier on a delivery becomes the usual one
    q = ok(api('GET', '/api/inventory/suppliers'))
    assert q[0]['parts'] == 1
    # a whole note
    p2 = part(api, partNumber='PN-2', sku='SH-2', name='Air filter')
    doc = ok(api('POST', '/api/inventory/documents', {'kind': 'RECEIPT', 'supplierId': s['id'], 'reference': 'DN-2', 'lines': [{'productId': p['id'], 'quantity': 2, 'unitCost': 950}, {'productId': p2['id'], 'quantity': 3, 'unitCost': 400}]}))
    assert doc
    page = ok(api('GET', '/api/inventory/suppliers/%s' % s['id']))  # the owner sees the money
    assert page['delivery_count'] == 2 and page['bought'] == 4 * 900 + 2 * 950 + 3 * 400 and {x['name'] for x in page['parts']} == {'Oil filter', 'Air filter'}
    note = [d for d in page['deliveries'] if d['reference'] == 'DN-2'][0]
    assert note['lines'] == 2 and note['quantity'] == 5 and note['cost'] == 3100 and note['doc_no'].startswith('GRN-')
    # a mechanic sees the supplier and the deliveries, never the money
    seen = ok(api('GET', '/api/inventory/suppliers/%s' % s['id'], role='MECHANIC'))
    assert 'bought' not in seen and all('cost' not in d for d in seen['deliveries']) and all('last_cost' not in x for x in seen['parts'])
    # a supplier that does not exist cannot be put on a delivery
    assert api('POST', '/api/inventory/movements', {'productId': p['id'], 'kind': 'RECEIPT', 'quantity': 1, 'supplierId': 'nope'})[0] == 404


def test_a_typed_name_still_works_and_finds_the_supplier(api):
    s = supplier(api)
    p = part(api)
    typed = ok(api('POST', '/api/inventory/movements', {'productId': p['id'], 'kind': 'RECEIPT', 'quantity': 1, 'supplier': 'lanka spares'}))
    assert typed['supplier_id'] == s['id'] and typed['supplier'] == 'Lanka Spares'
    free = ok(api('POST', '/api/inventory/movements', {'productId': p['id'], 'kind': 'RECEIPT', 'quantity': 1, 'supplier': 'Someone at the gate'}))
    assert free['supplier'] == 'Someone at the gate' and 'supplier_id' not in free
    # the older delivery with only a name still shows on the supplier's page
    assert ok(api('GET', '/api/inventory/suppliers/%s' % s['id']))['delivery_count'] == 1


def test_renaming_keeps_old_notes_and_updates_the_parts(api):
    s = supplier(api)
    p = part(api, supplierId=s['id'])
    mv = ok(api('POST', '/api/inventory/movements', {'productId': p['id'], 'kind': 'RECEIPT', 'quantity': 1, 'supplierId': s['id']}))
    ok(api('PATCH', '/api/inventory/suppliers/%s' % s['id'], {'revision': s['revision'], 'name': 'Lanka Spares (Pvt) Ltd'}, role='ADMIN'))
    assert ok(api('GET', '/api/inventory/products'))[0]['supplier'] == 'Lanka Spares (Pvt) Ltd'  # the part follows the new name
    old = next(m for m in ok(api('GET', '/api/inventory/movements')) if m['id'] == mv['id'])
    assert old['supplier'] == 'Lanka Spares'  # the note keeps the name of that day
    assert api('POST', '/api/inventory/suppliers', {'name': 'lanka spares (pvt) ltd'}, role='ADMIN')[0] == 409
    ok(api('POST', '/api/inventory/suppliers', {'name': 'Lanka Spares'}, role='ADMIN'))  # the old name is free again
    assert api('PATCH', '/api/inventory/suppliers/%s' % s['id'], {'revision': s['revision'], 'notes': 'x'}, role='ADMIN')[0] == 409  # stale
    assert api('PATCH', '/api/inventory/suppliers/%s' % s['id'], {'revision': s['revision'] + 1}, role='ADMIN')[0] == 400  # nothing changed


def test_a_closed_supplier_leaves_the_lists_but_keeps_its_history(api):
    s = supplier(api)
    p = part(api)
    ok(api('POST', '/api/inventory/movements', {'productId': p['id'], 'kind': 'RECEIPT', 'quantity': 2, 'supplierId': s['id']}))
    ok(api('PATCH', '/api/inventory/suppliers/%s' % s['id'], {'revision': s['revision'], 'active': False}, role='ADMIN'))
    assert names(api) == [] and names(api, query={'inactive': '1'}) == ['Lanka Spares']
    assert ok(api('GET', '/api/inventory/suppliers/%s' % s['id']))['delivery_count'] == 1
    code, body = api('POST', '/api/inventory/movements', {'productId': p['id'], 'kind': 'RECEIPT', 'quantity': 1, 'supplierId': s['id']})
    assert code == 400 and 'closed' in body['message']
    # editing a part whose usual supplier was closed does not fail and keeps the link
    item = ok(api('GET', '/api/inventory/products'))[0]
    ok(api('PATCH', '/api/inventory/products/%s' % item['id'], dict(PART, supplierId=s['id'], supplier='Lanka Spares', name='Oil filter 2')))
    assert ok(api('GET', '/api/inventory/products'))[0]['supplier_id'] == s['id']


def test_the_usual_supplier_of_a_part_can_be_changed_or_cleared(api):
    a, b = supplier(api), supplier(api, 'Kamal Auto', phone='0771112222')
    p = part(api, supplierId=a['id'])
    assert p['supplier'] == 'Lanka Spares' and p['supplier_id'] == a['id']
    ok(api('PATCH', '/api/inventory/products/%s' % p['id'], dict(PART, supplierId=b['id'])))
    assert ok(api('GET', '/api/inventory/products'))[0]['supplier'] == 'Kamal Auto'
    ok(api('PATCH', '/api/inventory/products/%s' % p['id'], dict(PART, supplierId='', supplier='')))
    got = ok(api('GET', '/api/inventory/products'))[0]
    assert not got.get('supplier') and 'supplier_id' not in got


def test_a_part_bought_outside_names_its_shop_from_the_list(api):
    local = ok(api('POST', '/api/inventory/suppliers', {'name': 'Kade Mudalali', 'kind': 'LOCAL', 'phone': '0715556666'}, role='ADMIN'))
    j = ok(api('POST', '/api/workshop/jobs', JOB, role='MECHANIC'))
    j = ok(api('PATCH', '/api/workshop/jobs/%s' % j['id'], {'revision': j['revision'], 'parts': [{'name': 'Bulb', 'quantity': 1, 'unit_price': 500, 'outside': True, 'outside_cost': 300, 'outside_supplier_id': local['id']}]}))
    line = ok(api('GET', '/api/workshop/jobs/%s' % j['id']))['parts'][0]
    assert line['outside_shop'] == 'Kade Mudalali' and line['outside_supplier_id'] == local['id'] and line['outside_cost'] == 300
    seen = ok(api('GET', '/api/workshop/jobs/%s' % j['id'], role='MECHANIC'))['parts'][0]
    assert 'outside_shop' not in seen and 'outside_supplier_id' not in seen  # who sold it is for the owner, like the cost
    # saving the job again from a screen that never saw the shop keeps it
    again = ok(api('GET', '/api/workshop/jobs/%s' % j['id'], role='MECHANIC'))
    ok(api('PATCH', '/api/workshop/jobs/%s' % j['id'], {'revision': again['revision'], 'parts': [{k: v for k, v in again['parts'][0].items()}]}, role='MECHANIC'))
    assert ok(api('GET', '/api/workshop/jobs/%s' % j['id']))['parts'][0]['outside_shop'] == 'Kade Mudalali'
    assert api('PATCH', '/api/workshop/jobs/%s' % j['id'], {'revision': again['revision'] + 1, 'parts': [{'name': 'Bulb', 'quantity': 1, 'unit_price': 5, 'outside': True, 'outside_supplier_id': 'nope'}]})[0] == 404


def test_who_may_see_and_change_suppliers(api):
    s = supplier(api)
    for role in ('MECHANIC', 'STOREKEEPER', 'ADMIN'):
        assert api('GET', '/api/inventory/suppliers', role=role)[0] == 200, role
        assert api('GET', '/api/inventory/suppliers/%s' % s['id'], role=role)[0] == 200, role
    for role in ('MECHANIC', 'STOREKEEPER'):
        assert api('POST', '/api/inventory/suppliers', {'name': 'X'}, role=role)[0] == 403
        assert api('PATCH', '/api/inventory/suppliers/%s' % s['id'], {'revision': 0, 'notes': 'x'}, role=role)[0] == 403
    v = ok(api('GET', '/api/workshop/permissions'))
    ok(api('PUT', '/api/workshop/permissions', {'roles': dict(v['roles'], STOREKEEPER=v['roles']['STOREKEEPER'] + ['suppliers_edit'])}))
    assert api('POST', '/api/inventory/suppliers', {'name': 'Added at the counter'}, role='STOREKEEPER')[0] == 200
    ok(api('PUT', '/api/workshop/permissions', {'roles': dict(v['roles'], MECHANIC=[k for k in v['roles']['MECHANIC'] if k != 'suppliers_view'])}))
    assert api('GET', '/api/inventory/suppliers', role='MECHANIC')[0] == 403
    p = part(api)
    assert api('POST', '/api/inventory/movements', {'productId': p['id'], 'kind': 'RECEIPT', 'quantity': 1, 'supplierId': s['id']}, role='MECHANIC')[0] == 200  # receiving still works


def test_each_shop_has_its_own_suppliers(api):
    mine = ok(api('POST', '/api/inventory/suppliers', {'name': 'ZZGANGA Spares'}, shop='ganga'))
    ok(api('POST', '/api/inventory/suppliers', {'name': 'ZZGANGA Spares'}, shop='other'))  # the same name in another shop is fine
    assert [s['name'] for s in ok(api('GET', '/api/inventory/suppliers', shop='other'))] == ['ZZGANGA Spares']
    assert api('GET', '/api/inventory/suppliers/%s' % mine['id'], shop='other')[0] == 404
    assert api('PATCH', '/api/inventory/suppliers/%s' % mine['id'], {'revision': 0, 'name': 'Hacked'}, shop='other')[0] == 404
    p = ok(api('POST', '/api/inventory/products', PART, shop='other'))
    assert api('POST', '/api/inventory/movements', {'productId': p['id'], 'kind': 'RECEIPT', 'quantity': 1, 'supplierId': mine['id']}, shop='other')[0] == 404


def test_export_includes_suppliers(api):
    supplier(api)
    assert [s['name'] for s in ok(api('GET', '/api/workshop/export'))['suppliers']] == ['Lanka Spares']
