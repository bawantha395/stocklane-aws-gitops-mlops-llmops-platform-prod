"""The store room layout: areas, racks and levels with ids that outlive a rename; deleting is guarded; shelves carry parts."""
from test_money_flow import ok
from test_shops import PART


def layout(api, **kw):
    return ok(api('GET', '/api/inventory/stores/layout', **kw))


def save(api, body, **kw):
    cur = layout(api, **kw)
    return api('PUT', '/api/inventory/stores/layout', dict({'revision': cur['revision']}, **body), **kw)


def part(api, **extra):
    return ok(api('POST', '/api/inventory/products', dict(PART, **extra)))


def test_the_layout_gets_ids_and_keeps_them_through_renames_and_moves(api):
    a = ok(save(api, {'areas': [{'name': 'Wall A'}, {'name': 'Middle'}], 'racks': [{'name': 'R1', 'type': 'RACK', 'levels': ['A', 'B']}, {'name': 'Cup', 'type': 'CUPBOARD', 'levels': []}]}))
    area, rack = a['areas'][0], a['racks'][0]
    assert a['areas'][1]['name'] == 'Middle' and rack['id'] and rack['levels'][0]['id'] and a['racks'][1]['type'] == 'CUPBOARD'
    # rename the rack, rename a level, move it to the other area, change its type: the ids stay
    new = [dict(rack, name='Brake rack', area_id=a['areas'][1]['id'], type='FLOOR', levels=[dict(rack['levels'][0], name='Top'), rack['levels'][1]]), a['racks'][1]]
    b = ok(save(api, {'areas': a['areas'], 'racks': new}))
    assert b['racks'][0]['id'] == rack['id'] and [l['id'] for l in b['racks'][0]['levels']] == [l['id'] for l in rack['levels']]
    assert b['racks'][0]['name'] == 'Brake rack' and b['racks'][0]['levels'][0]['name'] == 'Top' and b['racks'][0]['area_id'] == a['areas'][1]['id'] and b['racks'][0]['type'] == 'FLOOR'
    assert area['id'] == b['areas'][0]['id']
    # the older screens see names, and the ids ride along
    s = ok(api('GET', '/api/inventory/stores'))
    assert s['shelves'] == ['Brake rack-Top', 'Brake rack-B', 'Cup'] and s['racks'][0]['level_ids'] == [l['id'] for l in rack['levels']]


def test_a_renamed_shelf_takes_its_parts_with_it_and_a_busy_one_cannot_go(api):
    a = ok(save(api, {'areas': [{'name': 'Wall A'}], 'racks': [{'name': 'R1', 'levels': ['A', 'B']}]}))
    r = a['racks'][0]
    p = part(api, location='R1-A')
    assert p['rack_id'] == r['id'] and p['level_id'] == r['levels'][0]['id']  # a part remembers its shelf by id
    c = layout(api)
    assert c['counts'] == {r['id']: {r['levels'][0]['id']: 1}} and c['not_shelved'] == 0
    out = ok(save(api, {'areas': a['areas'], 'racks': [dict(r, name='Wall rack', levels=[dict(r['levels'][0], name='Top'), r['levels'][1]])]}))
    assert out['moved'] == 1
    got = [x for x in ok(api('GET', '/api/inventory/products')) if x['id'] == p['id']][0]
    assert got['location'] == 'Wall rack-Top' and got['rack_id'] == r['id']
    code, body = save(api, {'areas': a['areas'], 'racks': [dict(r, levels=[r['levels'][1]])]})  # the level with a part is removed
    assert code == 409 and 'Move those parts first' in body['message']
    assert save(api, {'areas': a['areas'], 'racks': []})[0] == 409  # so is the whole rack
    ok(save(api, {'areas': a['areas'], 'racks': [dict(r, levels=[dict(r['levels'][0], name='Top')])]}))  # an empty level can go


def test_parts_without_a_shelf_are_counted_as_not_shelved(api):
    ok(save(api, {'areas': [], 'racks': [{'name': 'R1', 'levels': ['A']}]}))
    part(api, location='R1-A')
    part(api, partNumber='PN-2', sku='SH-2', name='Air filter', location='')
    arch = part(api, partNumber='PN-3', sku='SH-3', name='Plug', openingQuantity=0)
    ok(api('POST', '/api/inventory/products/%s/archive' % arch['id'], {'archived': True}))
    assert layout(api)['not_shelved'] == 1  # archived parts are not counted


def test_limits_and_bad_input(api):
    ok(save(api, {'areas': [], 'racks': []}))
    assert save(api, {'areas': [{'name': 'A%d' % i} for i in range(9)], 'racks': []})[0] == 400
    assert save(api, {'areas': [{'name': 'A'}, {'name': 'a'}], 'racks': []})[0] == 400
    assert save(api, {'areas': [], 'racks': [{'name': 'R', 'levels': ['L%d' % i for i in range(21)]}]})[0] == 400
    assert save(api, {'areas': [], 'racks': [{'name': 'R', 'type': 'SHED'}]})[0] == 400
    assert save(api, {'areas': [], 'racks': [{'name': 'R', 'area_id': 'nope'}]})[0] == 400
    assert save(api, {'areas': [], 'racks': [{'name': 'R', 'id': 'ghost'}]})[0] == 404
    assert save(api, {'areas': [], 'racks': [{'name': 'R%d' % i} for i in range(101)]})[0] == 400
    assert save(api, {'areas': [], 'racks': [{'name': 'R', 'levels': ['A']}, {'name': 'R-A'}]})[0] == 400  # two shelves with one name


def test_someone_else_saved_first_means_reload(api):
    ok(save(api, {'areas': [], 'racks': [{'name': 'R', 'levels': []}]}))
    stale = layout(api)['revision']
    ok(save(api, {'areas': [], 'racks': [{'name': 'R2', 'levels': []}]}))
    code, body = api('PUT', '/api/inventory/stores/layout', {'revision': stale, 'areas': [], 'racks': []})
    assert code == 409 and 'Reload' in body['message']


def test_the_old_screens_never_lose_ids(api):
    a = ok(save(api, {'areas': [{'name': 'Wall A'}], 'racks': [{'name': 'R1', 'levels': ['A', 'B']}]}))
    ok(api('PUT', '/api/inventory/stores', {'racks': [{'name': 'R1', 'levels': ['B', 'A']}], 'categories': ['Brakes']}))  # names only, reordered
    b = layout(api)
    assert b['racks'][0]['id'] == a['racks'][0]['id'] and b['areas'] == a['areas']
    assert {l['name']: l['id'] for l in b['racks'][0]['levels']} == {l['name']: l['id'] for l in a['racks'][0]['levels']}
    ok(api('POST', '/api/inventory/stores/rename', {'kind': 'rack', 'from': 'R1', 'to': 'Front'}))
    assert layout(api)['racks'][0]['id'] == a['racks'][0]['id']


def test_a_level_can_hold_a_shelf_photo(api):
    a = ok(save(api, {'areas': [], 'racks': [{'name': 'R1', 'levels': ['A']}]}))
    pid = 'a' * 32
    r = a['racks'][0]
    b = ok(save(api, {'areas': [], 'racks': [dict(r, levels=[dict(r['levels'][0], photo_id=pid)])]}))
    assert b['racks'][0]['levels'][0]['photo_id'] == pid
    c = ok(save(api, {'areas': [], 'racks': [dict(b['racks'][0], levels=[{'id': r['levels'][0]['id'], 'name': 'A'}])]}))  # no photo field: kept
    assert c['racks'][0]['levels'][0]['photo_id'] == pid
    assert save(api, {'areas': [], 'racks': [dict(r, levels=[dict(r['levels'][0], photo_id='not-valid')])]})[0] == 400


def test_quick_start_makes_a_starting_layout_once(api):
    q = ok(api('POST', '/api/inventory/stores/quick-start', {}))
    assert [a['name'] for a in q['areas']] == ['Wall A', 'Wall B', 'Wall C', 'Wall D'] and len(q['racks']) == 12 and all(len(r['levels']) == 3 for r in q['racks'])
    assert q['racks'][0]['name'] == 'A1' and q['racks'][0]['area_id'] == q['areas'][0]['id']
    assert api('POST', '/api/inventory/stores/quick-start', {})[0] == 409
    assert api('GET', '/api/inventory/stores', role='MECHANIC')[0] == 200
    assert ok(api('GET', '/api/inventory/stores'))['shelves'][:3] == ['A1-A', 'A1-B', 'A1-C']


def test_permissions_and_shop_isolation(api):
    assert api('PUT', '/api/inventory/stores/layout', {'areas': [], 'racks': []}, role='MECHANIC')[0] == 403
    assert api('POST', '/api/inventory/stores/quick-start', {}, role='MECHANIC')[0] == 403
    assert api('GET', '/api/inventory/stores/layout', role='MECHANIC')[0] == 200  # everyone who works here may read it
    assert api('PUT', '/api/inventory/stores/layout', {'areas': [{'name': 'W'}], 'racks': []}, role='ADMIN')[0] == 200  # lists permission
    ok(api('POST', '/api/inventory/stores/quick-start', {}, shop='ganga'))
    assert layout(api, shop='other')['racks'] == [] and layout(api, shop='other')['areas'] == []


def test_the_categories_screen_can_save_without_touching_racks(api):
    a = ok(save(api, {'areas': [{'name': 'Wall A'}], 'racks': [{'name': 'R1', 'levels': ['A']}]}))
    ok(api('PUT', '/api/inventory/stores', {'categories': ['Brakes']}))  # no racks key
    b = layout(api)
    assert b['racks'] == a['racks'] and b['areas'] == a['areas'] and b['categories'] == ['Brakes']


def test_a_rack_can_name_an_area_made_in_the_same_save(api):
    r = ok(save(api, {'areas': [{'name': 'Wall A'}], 'racks': [{'name': 'R1', 'area_id': 'wall a', 'levels': []}]}))
    assert r['racks'][0]['area_id'] == r['areas'][0]['id']


def test_shelf_page_lists_parts_by_rack_level_and_unshelved(api):
    a = ok(save(api, {'areas': [{'name': 'Wall A'}], 'racks': [{'name': 'R1', 'type': 'RACK', 'levels': ['A', 'B']}]}))
    rack = a['racks'][0]
    on_a = part(api, name='Oil filter', location='R1-A')
    part(api, name='Brake pad', location='R1-B', partNumber='BP-1', sku='SH-2')
    part(api, name='Loose bolt', location='', partNumber='LB-1', sku='SH-3')

    def shelf(**q):
        return api('GET', '/api/inventory/stores/shelf', query=q)
    whole = ok(shelf(rack=rack['id']))
    assert [x['name'] for x in whole['parts']] == ['Brake pad', 'Oil filter']
    lvl = ok(shelf(rack=rack['id'], level=rack['levels'][0]['id']))
    assert [x['id'] for x in lvl['parts']] == [on_a['id']]
    none = ok(shelf(rack='none'))
    assert [x['name'] for x in none['parts']] == ['Loose bolt']
    assert 'cost' not in str(whole)
    assert shelf(rack='nope')[0] == 404
    assert shelf(rack=rack['id'], level='nope')[0] == 404
