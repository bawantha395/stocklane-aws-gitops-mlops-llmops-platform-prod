"""The owner's staff list: invite, change role, remove; only ever people of the owner's own shop."""
import boto3
import pytest
from test_stock_count import ok


@pytest.fixture
def pool(api, monkeypatch):
    idp = boto3.client('cognito-idp')
    pool = idp.create_user_pool(PoolName='p', UsernameAttributes=['email'])['UserPool']['Id']
    for name in ('OWNER', 'ADMIN', 'STOREKEEPER', 'MECHANIC', 'PLATFORM'):
        idp.create_group(UserPoolId=pool, GroupName=name)
    monkeypatch.setenv('USER_POOL_ID', pool)
    return idp, pool


def emails(rows):
    return [(r['email'], r['roles'], r['active']) for r in rows]


def test_owner_invites_changes_and_removes_staff(api, pool):
    idp, pid = pool
    ok(api('POST', '/api/platform/shops', {'id': 'ganga', 'name': 'Ganga Motors', 'owner_email': 'owner@ganga.lk'}, role='PLATFORM'))
    g = dict(shop='ganga')
    rows = ok(api('GET', '/api/workshop/staff', **g))
    assert emails(rows) == [('owner@ganga.lk', ['OWNER'], True)] and rows[0]['pending']
    me = rows[0]['id']
    rows = ok(api('POST', '/api/workshop/staff', {'email': 'Kamal@Ganga.lk', 'role': 'mechanic'}, who=me, **g))
    rows = ok(api('POST', '/api/workshop/staff', {'email': 'store@ganga.lk', 'role': 'STOREKEEPER'}, who=me, **g))
    assert emails(rows) == [('owner@ganga.lk', ['OWNER'], True), ('store@ganga.lk', ['STOREKEEPER'], True), ('kamal@ganga.lk', ['MECHANIC'], True)]
    kamal = rows[2]['id']
    groups = lambda u: sorted(x['GroupName'] for x in idp.admin_list_groups_for_user(UserPoolId=pid, Username=u)['Groups'])
    assert groups(kamal) == ['MECHANIC', 'SHOP_ganga']
    # the same e-mail twice, a bad role and a bad address are refused; a mechanic cannot open the list
    assert api('POST', '/api/workshop/staff', {'email': 'kamal@ganga.lk', 'role': 'ADMIN'}, who=me, **g)[0] == 409
    assert api('POST', '/api/workshop/staff', {'email': 'x@ganga.lk', 'role': 'BOSS'}, who=me, **g)[0] == 400
    assert api('POST', '/api/workshop/staff', {'email': 'nope', 'role': 'ADMIN'}, who=me, **g)[0] == 400
    assert api('GET', '/api/workshop/staff', role='MECHANIC', **g)[0] == 403
    # change the role: one role at a time
    rows = ok(api('POST', '/api/workshop/staff/%s/role' % kamal, {'role': 'ADMIN'}, who=me, **g))
    assert groups(kamal) == ['ADMIN', 'SHOP_ganga']
    # the owner cannot change or remove themself, and the only owner cannot be lost
    assert api('POST', '/api/workshop/staff/%s/role' % me, {'role': 'MECHANIC'}, who=me, **g)[0] == 400
    assert api('DELETE', '/api/workshop/staff/%s' % me, who=me, **g)[0] == 400
    assert api('POST', '/api/workshop/staff/%s/role' % me, {'role': 'MECHANIC'}, who=kamal, **g)[0] == 400  # (even if asked by someone else)
    assert api('DELETE', '/api/workshop/staff/%s' % me, who=kamal, **g)[0] == 400
    # with a second owner the first can step down
    ok(api('POST', '/api/workshop/staff/%s/role' % kamal, {'role': 'OWNER'}, who=me, **g))
    assert api('POST', '/api/workshop/staff/%s/role' % me, {'role': 'MECHANIC'}, who=kamal, **g)[0] == 200
    # remove: switched off, stays on the list as inactive, and inviting again switches the same person back on
    rows = ok(api('DELETE', '/api/workshop/staff/%s' % me, who=kamal, **g))
    assert ('owner@ganga.lk', ['MECHANIC'], False) in emails(rows)
    assert not idp.admin_get_user(UserPoolId=pid, Username=me)['Enabled']
    rows = ok(api('POST', '/api/workshop/staff', {'email': 'owner@ganga.lk', 'role': 'STOREKEEPER'}, who=kamal, **g))
    assert ('owner@ganga.lk', ['STOREKEEPER'], True) in emails(rows) and len(rows) == 3


def test_an_owner_never_reaches_another_shops_people(api, pool):
    idp, pid = pool
    ok(api('POST', '/api/platform/shops', {'id': 'ganga', 'name': 'Ganga Motors', 'owner_email': 'owner@ganga.lk'}, role='PLATFORM'))
    ok(api('POST', '/api/platform/shops', {'id': 'other', 'name': 'Other shop', 'owner_email': 'owner@other.lk'}, role='PLATFORM'))
    theirs = ok(api('GET', '/api/workshop/staff', shop='ganga'))[0]['id']
    assert emails(ok(api('GET', '/api/workshop/staff', shop='other'))) == [('owner@other.lk', ['OWNER'], True)]
    assert api('POST', '/api/workshop/staff/%s/role' % theirs, {'role': 'MECHANIC'}, shop='other')[0] == 404
    assert api('DELETE', '/api/workshop/staff/%s' % theirs, shop='other')[0] == 404
    assert api('POST', '/api/workshop/staff', {'email': 'owner@ganga.lk', 'role': 'ADMIN'}, shop='other')[0] == 409  # one person, one workshop
    assert idp.admin_get_user(UserPoolId=pid, Username=theirs)['Enabled']
    # the deployment's own default shop (no shop group) sees only people who are in no shop
    assert ok(api('GET', '/api/workshop/staff')) == []
    rows = ok(api('POST', '/api/workshop/staff', {'email': 'first@main.lk', 'role': 'MECHANIC'}))
    assert emails(rows) == [('first@main.lk', ['MECHANIC'], True)]
    assert len(ok(api('GET', '/api/workshop/staff', shop='ganga'))) == 1


def test_staff_limit_and_no_pool(api, pool, monkeypatch):
    from stocklane_api import staff
    monkeypatch.setattr(staff, 'MAX_STAFF', 2)
    ok(api('POST', '/api/workshop/staff', {'email': 'a@main.lk', 'role': 'MECHANIC'}))
    ok(api('POST', '/api/workshop/staff', {'email': 'b@main.lk', 'role': 'MECHANIC'}))
    assert api('POST', '/api/workshop/staff', {'email': 'c@main.lk', 'role': 'MECHANIC'})[0] == 400
    monkeypatch.delenv('USER_POOL_ID')
    assert api('GET', '/api/workshop/staff')[0] == 503
