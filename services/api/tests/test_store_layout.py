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
    assert [a['name'] for a in q['areas']] == ['Left wall', 'Right wall', 'Top wall', 'Bottom wall'] and [a['pos'] for a in q['areas']] == ['W', 'E', 'N', 'S']
    assert len(q['racks']) == 12 and all(len(r['levels']) == 3 for r in q['racks']) and [r['name'] for r in q['racks']] == [str(n) for n in range(1, 13)]
    assert q['racks'][0]['area_id'] == q['areas'][0]['id'] and q['racks'][3]['area_id'] == q['areas'][1]['id'] and q['racks'][11]['area_id'] == q['areas'][3]['id']
    lay = layout(api)
    assert '1-A' in ok(api('GET', '/api/inventory/stores'))['shelves'] and '12-C' in ok(api('GET', '/api/inventory/stores'))['shelves'] and lay['areas'] == q['areas']
    assert api('POST', '/api/inventory/stores/quick-start', {})[0] == 409
    assert api('GET', '/api/inventory/stores', role='MECHANIC')[0] == 200
    assert ok(api('GET', '/api/inventory/stores'))['shelves'][:3] == ['1-A', '1-B', '1-C']


def test_permissions_and_shop_isolation(api):
    assert api('PUT', '/api/inventory/stores/layout', {'areas': [], 'racks': []}, role='MECHANIC')[0] == 403
    assert api('POST', '/api/inventory/stores/quick-start', {}, role='MECHANIC')[0] == 403
    assert api('GET', '/api/inventory/stores/layout', role='MECHANIC')[0] == 200  # everyone who works here may read it
    assert api('PUT', '/api/inventory/stores/layout', {'areas': [{'name': 'W'}], 'racks': []}, role='ADMIN')[0] == 200  # lists permission
    ok(api('POST', '/api/inventory/stores/quick-start', {}, shop='ganga'))
    assert layout(api, shop='other')['racks'] == [] and len(layout(api, shop='other')['areas']) == 4  # always the four walls


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


def test_a_delivery_can_put_parts_on_a_shelf_and_a_note_with_a_bad_line_saves_nothing(api):
    a = ok(save(api, {'areas': [{'name': 'Wall A'}], 'racks': [{'name': 'R1', 'type': 'RACK', 'levels': ['A', 'B']}]}))
    rack = a['racks'][0]
    p1 = part(api, name='Oil filter')
    p2 = part(api, name='Brake pad', partNumber='BP-1', sku='SH-2', location='R1-A')
    doc = ok(api('POST', '/api/inventory/documents', {'kind': 'RECEIPT', 'reference': 'DN-1', 'lines': [
        {'productId': p1['id'], 'quantity': 2, 'location': 'r1-b'}, {'productId': p2['id'], 'quantity': 1, 'location': ''}]}))
    assert doc['doc_no'].startswith('GRN') and len(doc['lines']) == 2
    prods = {x['id']: x for x in ok(api('GET', '/api/inventory/products'))}
    assert prods[p1['id']]['location'] == 'R1-B' and prods[p1['id']]['rack_id'] == rack['id'] and prods[p1['id']]['level_id'] == rack['levels'][1]['id']
    assert prods[p2['id']]['location'] == 'R1-A' and prods[p1['id']]['quantity'] == 5
    # a shelf that is not on the owner's list is refused and nothing of the note is saved
    code, _ = api('POST', '/api/inventory/documents', {'kind': 'RECEIPT', 'lines': [{'productId': p2['id'], 'quantity': 4}, {'productId': p1['id'], 'quantity': 1, 'location': 'ZZ'}]})
    assert code == 400
    after = {x['id']: x for x in ok(api('GET', '/api/inventory/products'))}
    assert after[p2['id']]['quantity'] == prods[p2['id']]['quantity']
    # the same key twice saves once
    body = {'kind': 'RECEIPT', 'lines': [{'productId': p2['id'], 'quantity': 1}]}
    x = ok(api('POST', '/api/inventory/documents', body, key='k-batch-0000000001'))
    y = ok(api('POST', '/api/inventory/documents', body, key='k-batch-0000000001'))
    assert x['doc_no'] == y['doc_no']
    # more than 15 lines is refused (the screen splits it into two notes)
    many = [{'productId': p2['id'], 'quantity': 1}] * 16
    assert api('POST', '/api/inventory/documents', {'kind': 'RECEIPT', 'lines': many})[0] == 400


def _two_shelves(api):
    a = ok(save(api, {'areas': [{'name': 'Wall A'}], 'racks': [{'name': 'R1', 'type': 'RACK', 'levels': ['A', 'B']}, {'name': 'R2', 'type': 'RACK', 'levels': ['C']}]}))
    return a['racks'][0], a['racks'][1]


def move(api, body, **kw):
    return api('POST', '/api/inventory/stores/move', body, **kw)


def test_parts_move_between_shelves_with_history_and_stock_untouched(api):
    r1, r2 = _two_shelves(api)
    p1 = part(api, name='Oil filter', location='R1-A', openingQuantity=4)
    p2 = part(api, name='Brake pad', partNumber='BP-1', sku='SH-2', location='R1-A')
    r = ok(move(api, {'productIds': [p1['id'], p2['id']], 'rackId': r2['id'], 'levelId': r2['levels'][0]['id']}))
    assert r['shelf'] == 'R2-C' and len(r['moved']) == 2
    prods = {x['id']: x for x in ok(api('GET', '/api/inventory/products'))}
    assert prods[p1['id']]['location'] == 'R2-C' and prods[p1['id']]['rack_id'] == r2['id'] and prods[p1['id']]['level_id'] == r2['levels'][0]['id']
    assert prods[p1['id']]['quantity'] == 4  # a move never changes stock
    lay = layout(api)
    assert lay['counts'][r2['id']] == {r2['levels'][0]['id']: 2} and r1['id'] not in lay['counts']
    hist = [m for m in ok(api('GET', '/api/inventory/movements')) if m['kind'] == 'SHELF_MOVE']
    assert len(hist) == 2 and hist[0]['note'].startswith('Moved R1-A to R2-C') and hist[0]['quantity'] == 0 and hist[0]['actor']
    # already there: nothing to do; wrong rack / level / empty / duplicate / archived
    assert move(api, {'productIds': [p1['id']], 'rackId': r2['id'], 'levelId': r2['levels'][0]['id']})[0] == 409
    assert move(api, {'productIds': [p1['id']], 'rackId': 'nope'})[0] == 404
    assert move(api, {'productIds': [p1['id']], 'rackId': r1['id'], 'levelId': 'nope'})[0] == 400
    assert move(api, {'productIds': [p1['id']], 'rackId': r1['id']})[0] == 400  # a rack with levels needs a level
    assert move(api, {'productIds': [], 'rackId': r1['id']})[0] == 400
    assert move(api, {'productIds': [p1['id'], p1['id']], 'rackId': r1['id'], 'levelId': r1['levels'][0]['id']})[0] == 400
    # one bad part: none move
    code, _ = move(api, {'productIds': [p1['id'], 'nope'], 'rackId': r1['id'], 'levelId': r1['levels'][1]['id']})
    assert code == 404 and {x['id']: x['location'] for x in ok(api('GET', '/api/inventory/products'))}[p1['id']] == 'R2-C'
    # the same key twice moves once
    body = {'productIds': [p1['id']], 'rackId': r1['id'], 'levelId': r1['levels'][1]['id']}
    ok(move(api, body, key='k-move-000000000001')); ok(move(api, body, key='k-move-000000000001'))
    assert len([m for m in ok(api('GET', '/api/inventory/movements')) if m['kind'] == 'SHELF_MOVE']) == 3


def test_only_those_with_the_move_permission_can_move(api):
    r1, r2 = _two_shelves(api)
    p = part(api, location='R1-A')
    body = {'productIds': [p['id']], 'rackId': r2['id'], 'levelId': r2['levels'][0]['id']}
    assert move(api, body, role='MECHANIC')[0] == 403
    assert move(api, body, role='STOREKEEPER')[0] == 200
    assert move(api, dict(body, rackId=r1['id'], levelId=r1['levels'][0]['id']), role='ADMIN')[0] == 200


def count(api, body, **kw):
    return api('POST', '/api/inventory/stores/count', body, **kw)


def test_shelf_count_fixes_only_the_differences_and_remembers_the_day(api):
    r1, r2 = _two_shelves(api)
    a = part(api, name='Oil filter', location='R1-A', openingQuantity=5)
    b = part(api, name='Brake pad', partNumber='BP-1', sku='SC-2', location='R1-A', openingQuantity=3)
    c = part(api, name='Wiper', partNumber='W-1', sku='SC-3', location='R1-B', openingQuantity=2)
    lvl = r1['levels'][0]['id']
    r = ok(count(api, {'rackId': r1['id'], 'levelId': lvl, 'counts': [{'productId': a['id'], 'counted': 4}, {'productId': b['id'], 'counted': 3}]}))
    assert [x['name'] for x in r['changed']] == ['Oil filter'] and r['changed'][0]['now'] == 4
    prods = {x['id']: x['quantity'] for x in ok(api('GET', '/api/inventory/products'))}
    assert prods[a['id']] == 4 and prods[b['id']] == 3 and prods[c['id']] == 2
    kinds = [m['kind'] for m in ok(api('GET', '/api/inventory/movements')) if m['product_id'] == a['id']]
    assert 'COUNT_OUT' in kinds
    assert layout(api)['counted'][r1['id']][lvl]['at']
    # a part from another shelf, a repeat, a negative, an empty list and a missing rack are all refused; nothing changes
    assert count(api, {'rackId': r1['id'], 'levelId': lvl, 'counts': [{'productId': c['id'], 'counted': 1}]})[0] == 409
    assert count(api, {'rackId': r1['id'], 'levelId': lvl, 'counts': [{'productId': a['id'], 'counted': -1}]})[0] == 400
    assert count(api, {'rackId': r1['id'], 'levelId': lvl, 'counts': []})[0] == 400
    assert count(api, {'rackId': 'nope', 'counts': [{'productId': a['id'], 'counted': 1}]})[0] == 404
    assert {x['id']: x['quantity'] for x in ok(api('GET', '/api/inventory/products'))}[a['id']] == 4
    # same key twice counts once; only people with stock_count may count
    body = {'rackId': r1['id'], 'levelId': lvl, 'counts': [{'productId': a['id'], 'counted': 6}]}
    ok(count(api, body, key='k-count-00000000001')); ok(count(api, body, key='k-count-00000000001'))
    assert len([m for m in ok(api('GET', '/api/inventory/movements')) if m['product_id'] == a['id'] and m['kind'].startswith('COUNT')]) == 2
    assert count(api, body, role='MECHANIC')[0] == 403


def test_there_are_always_exactly_four_walls_and_only_their_names_change(api):
    first = layout(api)['areas']
    assert [a['pos'] for a in first] == ['W', 'E', 'N', 'S']
    out = ok(save(api, {'areas': [dict(a, name=n) for a, n in zip(first, ['Door side', 'Window side', 'Back', 'Front'])], 'racks': []}))
    assert [a['name'] for a in out['areas']] == ['Door side', 'Window side', 'Back', 'Front'] and [a['id'] for a in out['areas']] == [a['id'] for a in first]
    # a wall cannot be added, taken away or put in another place; two walls cannot share a name; a missing wall is kept as it was
    assert save(api, {'areas': out['areas'] + [{'name': 'Fifth'}], 'racks': []})[0] == 400
    assert save(api, {'areas': [dict(out['areas'][0], pos='E'), dict(out['areas'][1], pos='E')], 'racks': []})[0] == 400
    assert save(api, {'areas': [dict(out['areas'][0], name='Back')], 'racks': []})[0] == 400
    kept = ok(save(api, {'areas': [], 'racks': []}))['areas']
    assert [a['name'] for a in kept] == ['Door side', 'Window side', 'Back', 'Front']
    # a rack moves to another wall by its id; the level message names the rack
    r = ok(save(api, {'areas': kept, 'racks': [{'name': '1', 'area_id': kept[0]['id'], 'levels': ['A', 'B']}]}))['racks'][0]
    moved = ok(save(api, {'areas': kept, 'racks': [dict(r, area_id=kept[2]['id'])]}))['racks'][0]
    assert moved['area_id'] == kept[2]['id'] and moved['id'] == r['id']
    code, body = save(api, {'areas': kept, 'racks': [{'name': '1', 'levels': ['C', 'c']}]})
    assert code == 400 and 'Level "c" is on rack "1" twice' in str(body)


def test_the_store_room_and_counter_can_be_switched_off_and_stay_so(api):
    s = ok(api('GET', '/api/workshop/settings'))
    assert s['store_room_on'] is True and s['counter_on'] is True
    ok(api('PUT', '/api/workshop/settings', dict(s, store_room_on=False)))
    t2 = ok(api('GET', '/api/workshop/settings'))
    assert t2['store_room_on'] is False and t2['counter_on'] is True
    body = {k: v for k, v in t2.items() if k not in ('store_room_on', 'counter_on')}
    ok(api('PUT', '/api/workshop/settings', body))  # a screen that does not send the switches keeps them
    t3 = ok(api('GET', '/api/workshop/settings'))
    assert t3['store_room_on'] is False and t3['counter_on'] is True
