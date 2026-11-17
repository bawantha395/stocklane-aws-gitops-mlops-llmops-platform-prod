#!/usr/bin/env python3
"""Clear one shop's data from the table before go-live (old demo jobs, parts, racks, customers ...). Needs boto3 and AWS credentials.

  Look first (changes nothing):
    python3 scripts/clear_shop.py --table stocklane-prod --shop main

  Really delete (asks you to type the shop name again):
    python3 scripts/clear_shop.py --table stocklane-prod --shop main --yes --confirm main

Only rows whose key starts with T#<shop># are touched. The register of shops, other shops, Cognito users and the photo bucket are not.
Add --keep-settings to keep the business details and message words (WSET rows). Invoice, job and note numbers start again from 1.
Download all data in the app first (Setup, Your data): there is no undo here (point-in-time recovery makes a new table, it does not undo).
"""
import argparse
import sys

import boto3
from boto3.dynamodb.conditions import Attr


def main():
    a = argparse.ArgumentParser()
    a.add_argument('--table', required=True)
    a.add_argument('--shop', required=True)
    a.add_argument('--yes', action='store_true')
    a.add_argument('--confirm', default='')
    a.add_argument('--keep-settings', action='store_true')
    args = a.parse_args()
    table = boto3.resource('dynamodb').Table(args.table)
    prefix = 'T#%s#' % args.shop
    keys, counts, start = [], {}, None
    while True:
        r = table.scan(FilterExpression=Attr('pk').begins_with(prefix), ProjectionExpression='pk, sk', **({'ExclusiveStartKey': start} if start else {}))
        for item in r['Items']:
            kind = item['pk'][len(prefix):].split('#')[0]
            if args.keep_settings and kind == 'WSET':
                continue
            keys.append({'pk': item['pk'], 'sk': item['sk']})
            counts[kind] = counts.get(kind, 0) + 1
        start = r.get('LastEvaluatedKey')
        if not start:
            break
    print('Shop %r in table %s: %d rows' % (args.shop, args.table, len(keys)))
    for kind, n in sorted(counts.items(), key=lambda x: -x[1]):
        print('  %-14s %d' % (kind, n))
    if not args.yes:
        print('\nNothing deleted. Add --yes --confirm %s to delete these rows.' % args.shop)
        return
    if args.confirm != args.shop:
        sys.exit('Stopped: --confirm must be the shop name (%s).' % args.shop)
    with table.batch_writer() as batch:
        for k in keys:
            batch.delete_item(Key=k)
    print('Deleted %d rows.' % len(keys))


main()
