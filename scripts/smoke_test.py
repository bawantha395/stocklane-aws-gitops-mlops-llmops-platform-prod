#!/usr/bin/env python3
"""Smoke test for a deployed Lifta workshop site. Needs only Python 3.

  Read only (safe any time):
    python3 scripts/smoke_test.py --base https://workshop.example.com --token <access token>

  Full money flow (job, bill, payment, refund, void, delete). Run it ONCE after a deploy, with an OWNER token:
    python3 scripts/smoke_test.py --base https://workshop.example.com --token <access token> --write

The --write run leaves traces you cannot delete: vehicle ZZSMOKE1 and one VOID invoice (voided invoices stay in the books by design).
Everything else is deleted (archived) again. The token is the access token of a signed in OWNER: sign in on the site, open the browser
developer tools, Application, Local or Session storage, the key that starts with oidc.user, and copy access_token.
"""
import argparse
import json
import sys
import urllib.error
import urllib.request
import uuid

failures = []


def call(base, token, method, path, body=None):
    request = urllib.request.Request(base.rstrip('/') + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                     headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Idempotency-Key': str(uuid.uuid4())})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read() or b'null')
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read() or b'null')
        except ValueError:
            return error.code, None


def check(name, ok, detail=''):
    print(('PASS  ' if ok else 'FAIL  ') + name + (('  ' + str(detail)) if detail and not ok else ''))
    if not ok:
        failures.append(name)
    return ok


def need(base, token, method, path, body=None, expect=200):
    status, data = call(base, token, method, path, body)
    check(method + ' ' + path, status == expect, '%s %s' % (status, data))
    return data if status == expect else None


def read_only(base, token):
    for path in ('/api/workshop/settings', '/api/workshop/jobs', '/api/workshop/invoices', '/api/workshop/vehicles', '/api/workshop/dashboard',
                 '/api/workshop/service-due', '/api/workshop/report', '/api/inventory/products', '/api/workshop/messages', '/api/workshop/messages/count',
                 '/api/workshop/messages/templates', '/api/workshop/cockpit', '/api/workshop/alerts', '/api/workshop/slow-stock'):
        need(base, token, 'GET', path)
    data = need(base, token, 'GET', '/api/workshop/export')  # only the newest version of the API has this route
    if data:
        check('export has the expected parts', all(k in data for k in ('jobs', 'invoices', 'vehicles', 'stock_parts')))


def public_page(base, token, job_id=None):
    """The customer's link needs no sign-in. A wrong link must answer 404 and nothing else; with a job, a real link must show it and then stop after revoke."""
    def open_(link):
        try:
            with urllib.request.urlopen(base.rstrip('/') + '/api/public/track/' + link, timeout=30) as r:
                return r.status, json.loads(r.read() or b'null')
        except urllib.error.HTTPError as e:
            return e.code, None
    check('a wrong customer link answers 404 with no sign-in', open_('main~not-a-real-link')[0] == 404)
    if job_id:
        made = need(base, token, 'POST', '/api/workshop/jobs/%s/link' % job_id, {})
        if made:
            status, page = open_(made['link']['token'])
            check('a real customer link shows the job', status == 200 and page and page['job']['registration'] == 'ZZSMOKE1', status)
            check('the page holds no cost or staff fields', page is not None and not any(w in json.dumps(page).lower() for w in ('cost', 'profit', 'created_by')))
            need(base, token, 'POST', '/api/workshop/jobs/%s/link/revoke' % job_id, {})
            check('a switched-off link answers 404', open_(made['link']['token'])[0] == 404)


def money_flow(base, token):
    job = need(base, token, 'POST', '/api/workshop/jobs', {'registration': 'ZZ-SMOKE-1', 'customer': 'Smoke Test', 'phone': '0770000000', 'summary': 'Smoke test'})
    if not job:
        return
    other = need(base, token, 'POST', '/api/workshop/jobs', {'registration': 'ZZ-SMOKE-1', 'customer': 'Other Person', 'summary': 'Second job'})
    vehicle = need(base, token, 'GET', '/api/workshop/vehicles/ZZSMOKE1')
    if vehicle:
        check('a second job with another name does not change the vehicle owner', vehicle['owner'] == 'Smoke Test', vehicle.get('owner'))
    public_page(base, token, job['id'])
    staged = need(base, token, 'POST', '/api/workshop/jobs/%s/stage' % job['id'], {'stage': 'READY'})
    if staged:
        check('a stage change keeps the revision', staged['stage'] == 'READY' and staged['revision'] == job['revision'], staged.get('revision'))
    saved = need(base, token, 'PATCH', '/api/workshop/jobs/' + job['id'], {'labour': [{'description': 'Smoke test', 'amount': 100}], 'warranty_until': '2099-01-01',
                                                                         'brought_by': 'Smoke Driver', 'revision': job['revision']})
    invoice = saved and need(base, token, 'POST', '/api/workshop/jobs/%s/invoice' % job['id'], {'revision': saved['revision']})
    if invoice:
        check('the invoice keeps the warranty and who brought it in', invoice.get('warranty_until') == '2099-01-01' and invoice.get('brought_by') == 'Smoke Driver')
        need(base, token, 'POST', '/api/workshop/invoices/%s/payments' % invoice['id'], {'amount': invoice['total'], 'method': 'CASH'})
        need(base, token, 'POST', '/api/workshop/invoices/%s/refund' % invoice['id'], {'amount': invoice['total'], 'method': 'CASH', 'reason': 'Smoke test'})
        need(base, token, 'GET', '/api/workshop/invoices/%s/pdf' % invoice['id'])
        need(base, token, 'POST', '/api/workshop/invoices/%s/void' % invoice['id'], {})
    for j in (job, other):
        if j:
            need(base, token, 'POST', '/api/workshop/jobs/%s/archive' % j['id'], {'reason': 'Smoke test clean up'})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', required=True)
    parser.add_argument('--token', required=True)
    parser.add_argument('--write', action='store_true', help='also run the full money flow (needs an OWNER token)')
    args = parser.parse_args()
    read_only(args.base, args.token)
    public_page(args.base, args.token)
    if args.write:
        money_flow(args.base, args.token)
    print('\n%s' % ('ALL CHECKS PASSED' if not failures else 'FAILED: ' + ', '.join(failures)))
    sys.exit(1 if failures else 0)


main()
