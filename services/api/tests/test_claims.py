"""Supplier warranty claims: opened for a part and a supplier, followed to an end, never changed after it ended."""
from test_money_flow import ok
from test_stock_count import product


def supplier(api, name='Lanka Parts'):
    return ok(api('POST', '/api/inventory/suppliers', {'name': name, 'kind': 'MAIN'}))


def claim(api, p, s, **extra):
    return api('POST', '/api/inventory/claims', dict({'productId': p['id'], 'supplierId': s['id'], 'quantity': 2, 'reason': 'Leaks after a week'}, **extra), role='STOREKEEPER')


def test_open_follow_and_end_a_claim(api):
    p, s = product(api, 10), supplier(api)
    c = ok(claim(api, p, s, ref='GRN-0001'))
    assert c['status'] == 'OPEN' and c['claim_no'] == 'WC-0001' and c['supplier'] == 'Lanka Parts' and c['quantity'] == 2 and c['timeline'][0]['note'] == 'Leaks after a week'
    sent = ok(api('POST', '/api/inventory/claims/%s/status' % c['id'], {'status': 'SENT', 'revision': c['revision'], 'note': 'Handed to the rep'}, role='STOREKEEPER'))
    assert sent['status'] == 'SENT' and len(sent['timeline']) == 2
    assert api('POST', '/api/inventory/claims/%s/status' % c['id'], {'status': 'SENT', 'revision': c['revision']}, role='STOREKEEPER')[0] == 409  # stale
    assert api('POST', '/api/inventory/claims/%s/status' % c['id'], {'status': 'CREDITED', 'revision': sent['revision']}, role='STOREKEEPER')[0] == 400  # credit amount missing
    done = ok(api('POST', '/api/inventory/claims/%s/status' % c['id'], {'status': 'CREDITED', 'revision': sent['revision'], 'credit': 3600}, role='STOREKEEPER'))
    assert done['status'] == 'CREDITED' and done['credit'] == 3600
    assert api('POST', '/api/inventory/claims/%s/status' % c['id'], {'status': 'REJECTED', 'revision': done['revision'], 'note': 'x'}, role='STOREKEEPER')[0] == 409  # ended
    assert ok(api('GET', '/api/inventory/claims', query={'status': 'ACTIVE'}))['claims'] == [] and ok(api('GET', '/api/inventory/claims'))['open'] == 0


def test_rules_and_permissions(api):
    p, s = product(api, 10), supplier(api)
    assert claim(api, p, s, reason='')[0] == 400
    assert claim(api, p, s, quantity=0)[0] == 400
    assert claim(api, p, s, productId='nope')[0] == 404
    assert api('POST', '/api/inventory/claims', {'productId': p['id'], 'supplierId': s['id'], 'quantity': 1, 'reason': 'x'}, role='MECHANIC')[0] == 403
    c = ok(claim(api, p, s))
    r = api('POST', '/api/inventory/claims/%s/status' % c['id'], {'status': 'REJECTED', 'revision': c['revision']}, role='STOREKEEPER')
    assert r[0] == 400  # a rejection needs the supplier's reason
    assert ok(api('GET', '/api/inventory/claims', query={'status': 'OPEN'}))['open'] == 1
    assert api('GET', '/api/inventory/claims/%s' % c['id'], role='MECHANIC')[0] == 200
