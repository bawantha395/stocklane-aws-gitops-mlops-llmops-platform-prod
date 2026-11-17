"""The platform owner's desk: the register of workshops (shops) that share this deployment.

A shop is a key prefix in the table plus a Cognito group "SHOP_<id>". Opening a shop writes its register row, seeds its name and
the standard part categories, and (when a user pool is configured) invites its first owner by e-mail. Nothing here can read a
shop's stock, jobs or bills.
"""
import os
import re

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

from . import core
from .core import ApiError, bad, conflict, missing, now, table

STANDARD_CATEGORIES = ['Engine', 'Filters', 'Oils & lubricants', 'Brakes', 'Suspension & steering', 'Transmission & clutch',
                       'Electrical & lighting', 'Battery', 'Cooling & AC', 'Fuel system', 'Exhaust', 'Belts & hoses',
                       'Bearings & seals', 'Body & trim', 'Tyres & wheels', 'Wipers & accessories', 'Consumables']
EMAIL = re.compile(r'[^@\s]{1,64}@[^@\s]{1,120}\.[^@\s]{2,}')
MAX_SHOPS = 500


def _rows():
    rows, start = [], None
    while True:
        args = {'KeyConditionExpression': Key('pk').eq('SHOPS')}
        if start:
            args['ExclusiveStartKey'] = start
        page = table().query(**args)
        rows += page['Items']
        start = page.get('LastEvaluatedKey')
        if not start:
            return rows


def view(row):
    return {'id': row['sk'], 'name': row.get('name', ''), 'owner_email': row.get('owner_email', ''), 'suspended': bool(row.get('suspended')),
            'created_at': row.get('created_at', ''), 'invited': bool(row.get('invited'))}


def shops():
    return sorted((view(r) for r in _rows()), key=lambda s: s['created_at'])


def invite(shop, email):
    """Create the shop's Cognito group and its first owner (Cognito e-mails a temporary password). Returns False when this
    deployment has no user pool configured, so the platform owner adds the user by hand."""
    pool = os.environ.get('USER_POOL_ID')
    if not pool:
        return False
    idp, group = boto3.client('cognito-idp'), core.GROUP + shop
    try:
        idp.create_group(UserPoolId=pool, GroupName=group, Description='Workshop ' + shop)
    except ClientError as error:
        if error.response['Error']['Code'] != 'GroupExistsException':
            raise
    try:
        idp.admin_create_user(UserPoolId=pool, Username=email, DesiredDeliveryMediums=['EMAIL'],
                              UserAttributes=[{'Name': 'email', 'Value': email}, {'Name': 'email_verified', 'Value': 'true'}])
    except ClientError as error:
        if error.response['Error']['Code'] != 'UsernameExistsException':
            raise
        # an existing sign-in may only join a shop when it is in none: one person, one workshop
        mine = [g['GroupName'] for g in idp.admin_list_groups_for_user(UserPoolId=pool, Username=email)['Groups']]
        if any(g.startswith(core.GROUP) and g != group for g in mine):
            raise conflict('%s already belongs to another workshop' % email) from None
    for name in ('OWNER', group):
        idp.admin_add_user_to_group(UserPoolId=pool, Username=email, GroupName=name)
    return True


def create(body):
    b = body or {}
    shop = str(b.get('id') or '').strip().lower()
    if not core.SHOP.fullmatch(shop):
        raise bad('The workshop ID is 2 to 31 small letters, numbers or dashes (for example ganga-motors)')
    name = str(b.get('name') or '').strip()
    if not 2 <= len(name) <= 80:
        raise bad('The workshop name is 2 to 80 characters')
    email = str(b.get('owner_email') or '').strip().lower()
    if email and not EMAIL.fullmatch(email):
        raise bad('Check the owner e-mail address')
    if len(_rows()) >= MAX_SHOPS:
        raise bad('This deployment holds up to %d workshops' % MAX_SHOPS)
    row = {'pk': 'SHOPS', 'sk': shop, 'name': name, 'owner_email': email, 'created_at': now(), 'suspended': False, 'invited': False}
    try:
        table().put_item(Item=row, ConditionExpression='attribute_not_exists(pk)')
    except ClientError as error:
        if error.response['Error']['Code'] == 'ConditionalCheckFailedException':
            raise conflict('A workshop with the ID %s already exists' % shop) from None
        raise
    # the new shop starts with its name on the bills and the standard categories; both only when nothing is there yet
    for item in ({'pk': 'T#%s#WSET' % shop, 'sk': 'business', 'name': name},
                 {'pk': 'T#%s#STORES' % shop, 'sk': 'main', 'racks': [], 'categories': STANDARD_CATEGORIES if b.get('standard_categories', True) else [], 'revision': 1}):
        try:
            table().put_item(Item=item, ConditionExpression='attribute_not_exists(pk)')
        except ClientError as error:
            if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise
    if email and invite(shop, email):
        table().update_item(Key={'pk': 'SHOPS', 'sk': shop}, UpdateExpression='SET invited = :t', ExpressionAttributeValues={':t': True})
        row['invited'] = True
    return view(row)


def suspend(shop, body):
    """Close or reopen a shop's door. Its data stays exactly as it is."""
    value = bool((body or {}).get('suspended'))
    try:
        table().update_item(Key={'pk': 'SHOPS', 'sk': shop}, UpdateExpression='SET suspended = :s', ConditionExpression='attribute_exists(pk)',
                            ExpressionAttributeValues={':s': value})
    except ClientError as error:
        if error.response['Error']['Code'] == 'ConditionalCheckFailedException':
            raise missing('Workshop not found') from None
        raise
    _open.clear()
    return view(table().get_item(Key={'pk': 'SHOPS', 'sk': shop})['Item'])


_open = {}  # shop -> (checked at, allowed); one small read a minute per shop, not one per request


def admit(shop):
    """Stop a suspended shop at the door. A shop with no register row is the deployment's own default shop (or, with
    REQUIRE_SHOP, nobody)."""
    import time
    seen = _open.get(shop)
    if not seen or time.monotonic() - seen[0] > 60:
        row = table().get_item(Key={'pk': 'SHOPS', 'sk': shop}).get('Item')
        allowed = (not row.get('suspended')) if row else (shop == core.default_shop() or os.environ.get('REQUIRE_SHOP') != '1')
        seen = _open[shop] = (time.monotonic(), allowed)
    if not seen[1]:
        raise ApiError(403, 'This workshop is closed. Contact Lifta support.')
