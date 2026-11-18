"""Leak alerts and the owner's cockpit: each alert fires, Seen sticks, and the numbers equal the report."""
from test_money_audit import setup
from test_money_flow import ok


def alerts(api, **kw):
    return ok(api('GET', '/api/workshop/alerts', role='OWNER', **kw))


def kinds(api, **kw):
    return {a['type'] for a in alerts(api, **kw)['alerts']}


def bill(api, **patch):
    p, j = setup(api)
    if patch:
        j = ok(api('PATCH', '/api/workshop/jobs/%s' % j['id'], dict({'revision': j['revision']}, **patch)))
    inv = ok(api('POST', '/api/workshop/jobs/%s/invoice' % j['id'], {'revision': j['revision']}, role='MECHANIC'))
    return p, j, inv


def test_quiet_when_nothing_is_wrong(api):
    bill(api)
    assert alerts(api) == {'alerts': [], 'unseen': 0, 'types': alerts(api)['types']}


def test_below_cost_and_big_discount(api):
    p, j = setup(api)
    parts = [dict(x) for x in j['parts']]
    for x in parts:
        if x.get('outside'):
            x['unit_price'] = 200  # cost 300
    j = ok(api('PATCH', '/api/workshop/jobs/%s' % j['id'], {'revision': j['revision'], 'parts': parts, 'discount': 1500}))
    ok(api('POST', '/api/workshop/jobs/%s/invoice' % j['id'], {'revision': j['revision']}, role='MECHANIC'))
    got = {a['type']: a for a in alerts(api)['alerts']}
    assert set(got) == {'BELOW_COST', 'DISCOUNT'}
    assert 'Bulb' in got['BELOW_COST']['detail'] and '%' in got['DISCOUNT']['detail']


def test_void_refund_count_cost_edit_and_stock_return(api):
    p, j, inv = bill(api)
    ok(api('POST', '/api/workshop/invoices/%s/void' % inv['id'], {'reason': 'Wrong car'}, role='OWNER'))
    assert 'VOID' in kinds(api)
    # a second bill, paid then refunded
    from test_job_stock import new_job
    j2 = ok(api('PATCH', '/api/workshop/jobs/%s' % new_job(api, 'CAB-9999')['id'], {'revision': 0, 'labour': [{'description': 'Labour', 'amount': 3000}]}))
    inv2 = ok(api('POST', '/api/workshop/jobs/%s/invoice' % j2['id'], {'revision': j2['revision']}, role='MECHANIC'))
    ok(api('POST', '/api/workshop/invoices/%s/payments' % inv2['id'], {'amount': 1000, 'method': 'CASH'}, role='MECHANIC'))
    ok(api('POST', '/api/workshop/invoices/%s/refund' % inv2['id'], {'amount': 500, 'method': 'CASH', 'reason': 'Overcharged'}, role='OWNER'))
    ok(api('POST', '/api/inventory/movements', {'kind': 'COUNT', 'productId': p['id'], 'quantity': 3, 'note': 'Counted'}))
    mv = ok(api('POST', '/api/inventory/movements', {'productId': p['id'], 'kind': 'RECEIPT', 'quantity': 1, 'unitCost': 800}))
    ok(api('POST', '/api/inventory/movements/%s/cost' % mv['id'], {'unitCost': 950}, role='OWNER'))
    s = ok(api('POST', '/api/inventory/suppliers', {'name': 'ABC Parts'}))
    ok(api('POST', '/api/inventory/supplier-returns', {'supplierId': s['id'], 'reason': 'Wrong part', 'reference': 'CN-9', 'lines': [{'productId': p['id'], 'quantity': 1, 'unitCost': 800}]}))
    got = {a['type']: a for a in alerts(api)['alerts']}
    assert {'VOID', 'REFUND', 'COUNT', 'COST_EDIT', 'STOCK_RETURN'} <= set(got)
    assert got['COST_EDIT']['detail'] == 'from 800 to 950' and got['REFUND']['amount'] == 500
    assert ok(api('GET', '/api/workshop/books-check', role='OWNER'))['ok']  # void, refund, count, delivery and a supplier return leave the books in agreement


def test_seen_sticks_and_is_per_shop(api):
    bill(api, discount=2000)
    a = alerts(api)
    assert a['unseen'] == 1 and a['alerts'][0]['type'] == 'DISCOUNT'
    ok(api('POST', '/api/workshop/alerts/seen', {'keys': [a['alerts'][0]['key']]}, role='OWNER', who='ashen'))
    b = alerts(api)
    assert b['unseen'] == 0 and b['alerts'][0]['seen'] is True and b['alerts'][0]['seen_by'] == 'ashen'
    ok(api('POST', '/api/workshop/alerts/seen', {'all': True}, role='OWNER'))
    assert api('POST', '/api/workshop/alerts/seen', {'keys': ['NOPE#1']}, role='OWNER')[0] == 400
    assert api('POST', '/api/workshop/alerts/seen', {'keys': []}, role='OWNER')[0] == 400
    assert alerts(api, shop='other')['alerts'] == []


def test_only_those_with_alerts_permission(api):
    for role in ('MECHANIC', 'STOREKEEPER', 'ADMIN'):
        assert api('GET', '/api/workshop/alerts', role=role)[0] == 403
        assert api('GET', '/api/workshop/cockpit', role=role)[0] == 403
        assert api('POST', '/api/workshop/alerts/seen', {'all': True}, role=role)[0] == 403
    assert api('GET', '/api/workshop/alerts', role='OWNER')[0] == 200


def test_cockpit_numbers_equal_the_report(api):
    p, j, inv = bill(api)
    ok(api('POST', '/api/workshop/invoices/%s/payments' % inv['id'], {'amount': 1000, 'method': 'CASH'}, role='MECHANIC'))
    c = ok(api('GET', '/api/workshop/cockpit', role='OWNER'))
    r = ok(api('GET', '/api/workshop/report', role='OWNER'))
    assert c['month']['profit'] == r['profit']['profit'] and c['month']['received'] == r['received'] and c['month']['billed'] == r['total']
    assert c['today']['received'] == 1000 and c['owing'] == inv['total'] - 1000 and c['owing_count'] == 1
    assert {'to_order', 'approvals', 'messages', 'alerts'} <= set(c)
