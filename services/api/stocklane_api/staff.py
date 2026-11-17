"""The owner's staff list: who can sign in to this shop and in which role.

People are Cognito users; a role is a Cognito group (see perms.py) and a shop is the group "SHOP_<id>". The deployment's own
default shop has no group: its people are the ones who belong to no shop group at all. An owner can only ever see and
change people of their own shop.
"""
import os

import boto3
from botocore.exceptions import ClientError

from . import core, perms
from .core import ApiError, bad, conflict, missing
from .platform import EMAIL

MAX_STAFF = 25


def _pool():
    pool = os.environ.get('USER_POOL_ID')
    if not pool:
        raise ApiError(503, 'Staff cannot be managed here yet. Ask Lifta support to add the person.')
    return boto3.client('cognito-idp'), pool


def _in_group(idp, pool, group):
    users, token = [], None
    while True:
        args = {'UserPoolId': pool, 'GroupName': group, 'Limit': 60}
        if token:
            args['NextToken'] = token
        try:
            page = idp.list_users_in_group(**args)
        except ClientError as error:
            if error.response['Error']['Code'] == 'ResourceNotFoundException':
                return []  # the group was never made: nobody is in it
            raise
        users += page['Users']
        token = page.get('NextToken')
        if not token:
            return users


def _shop_groups(idp, pool):
    names, token = [], None
    while True:
        args = {'UserPoolId': pool, 'Limit': 60}
        if token:
            args['NextToken'] = token
        page = idp.list_groups(**args)
        names += [g['GroupName'] for g in page['Groups'] if g['GroupName'].startswith(core.GROUP)]
        token = page.get('NextToken')
        if not token:
            return names


def _people(idp, pool):
    """username -> {id, email, roles, active, pending} for this shop only."""
    shop, people = core.shop(), {}
    for role in perms.ROLES:
        for u in _in_group(idp, pool, role):
            email = next((a['Value'] for a in u.get('Attributes', []) if a['Name'] == 'email'), '')
            p = people.setdefault(u['Username'], {'id': u['Username'], 'email': email, 'roles': [], 'active': bool(u.get('Enabled', True)),
                                                  'pending': u.get('UserStatus') == 'FORCE_CHANGE_PASSWORD'})
            p['roles'].append(role)
    if shop == core.default_shop():
        elsewhere = {u['Username'] for g in _shop_groups(idp, pool) if g != core.GROUP + shop for u in _in_group(idp, pool, g)}
        return {k: v for k, v in people.items() if k not in elsewhere}
    mine = {u['Username'] for u in _in_group(idp, pool, core.GROUP + shop)}
    return {k: v for k, v in people.items() if k in mine}


def staff():
    idp, pool = _pool()
    return sorted(_people(idp, pool).values(), key=lambda p: (perms.ROLES.index(p['roles'][0]), p['email']))


def _role(body):
    role = str((body or {}).get('role') or '').upper()
    if role not in perms.ROLES:
        raise bad('Choose a role: Owner, Admin, Store keeper or Mechanic')
    return role


def _set_role(idp, pool, username, role, current=()):
    for old in current:
        if old != role:
            idp.admin_remove_user_from_group(UserPoolId=pool, Username=username, GroupName=old)
    idp.admin_add_user_to_group(UserPoolId=pool, Username=username, GroupName=role)


def invite(body):
    """Add a person by e-mail. Cognito sends the temporary password. Someone who was removed before is switched back on."""
    idp, pool = _pool()
    email, role = str((body or {}).get('email') or '').strip().lower(), _role(body)
    if not EMAIL.fullmatch(email):
        raise bad('Check the e-mail address')
    people, shop = _people(idp, pool), core.shop()
    known = next((p for p in people.values() if p['email'].lower() == email), None)
    if known:
        if known['active']:
            raise conflict('%s is already on the list. Change the role there.' % email)
        idp.admin_enable_user(UserPoolId=pool, Username=known['id'])
        _set_role(idp, pool, known['id'], role, known['roles'])
        return staff()
    if len(people) >= MAX_STAFF:
        raise bad('A workshop can have up to %d people. Remove someone first.' % MAX_STAFF)
    try:
        made = idp.admin_create_user(UserPoolId=pool, Username=email, DesiredDeliveryMediums=['EMAIL'],
                                     UserAttributes=[{'Name': 'email', 'Value': email}, {'Name': 'email_verified', 'Value': 'true'}])
        username = made['User']['Username']
    except ClientError as error:
        if error.response['Error']['Code'] != 'UsernameExistsException':
            raise
        # the sign-in exists but is not in this shop: it belongs to another workshop (or to nobody, if it was never given a role)
        groups = [g['GroupName'] for g in idp.admin_list_groups_for_user(UserPoolId=pool, Username=email)['Groups']]
        if groups:
            raise conflict('%s already uses Lifta in another workshop. Use a different e-mail address.' % email) from None
        username = email
    if shop != core.default_shop():
        try:
            idp.create_group(UserPoolId=pool, GroupName=core.GROUP + shop)
        except ClientError as error:
            if error.response['Error']['Code'] != 'GroupExistsException':
                raise
        idp.admin_add_user_to_group(UserPoolId=pool, Username=username, GroupName=core.GROUP + shop)
    _set_role(idp, pool, username, role)
    return staff()


def _person(idp, pool, username, who):
    people = _people(idp, pool)
    person = people.get(username)
    if not person:
        raise missing('That person is not in this workshop')  # also the answer for someone in another shop
    if username == who:
        raise bad('You cannot change your own sign-in. Ask another owner.')
    return person, people


def _keeps_an_owner(person, people):
    if 'OWNER' in person['roles'] and not any('OWNER' in p['roles'] and p['active'] and p['id'] != person['id'] for p in people.values()):
        raise bad('A workshop needs at least one owner')


def set_role(username, who, body):
    idp, pool = _pool()
    role = _role(body)
    person, people = _person(idp, pool, username, who)
    if role != 'OWNER':
        _keeps_an_owner(person, people)
    _set_role(idp, pool, username, role, person['roles'])
    return staff()


def remove(username, who):
    """Switch a person's sign-in off and sign them out everywhere. Their name stays on old jobs and bills."""
    idp, pool = _pool()
    person, people = _person(idp, pool, username, who)
    _keeps_an_owner(person, people)
    idp.admin_disable_user(UserPoolId=pool, Username=username)
    try:
        idp.admin_user_global_sign_out(UserPoolId=pool, Username=username)
    except ClientError:
        pass  # switched off is what matters
    return staff()
