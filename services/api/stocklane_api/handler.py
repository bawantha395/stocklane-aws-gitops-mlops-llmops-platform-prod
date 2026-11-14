"""Lambda entry point: an HTTP API (payload v2) router plus the scheduled jobs.

Sign-in is checked by the API Gateway JWT authorizer (Cognito); this code checks the role
(OWNER or MECHANIC) from the verified token for every route.
"""
import base64
import json
import re
import traceback

from . import forecast, inventory, photos, workshop
from .core import ApiError, actor, bad, dumps, groups, require

OWNER, STAFF = ('OWNER',), ('OWNER', 'MECHANIC')
ROUTES = []


def route(method, pattern, roles, fn, needs_key=False, body=False):
    ROUTES.append((method, re.compile('^' + pattern + '$'), roles, fn, needs_key, body))


def q(event, name, default=''):
    return (event.get('queryStringParameters') or {}).get(name, default)


route('GET', '/api/inventory/session', None, lambda e, p, b, k: {'name': actor(e), 'roles': ['ROLE_' + g for g in sorted(groups(e))]})
route('GET', '/api/inventory/products', STAFF, lambda e, p, b, k: inventory.products())
route('GET', '/api/inventory/products/archived', OWNER, lambda e, p, b, k: inventory.archived_products())
route('GET', '/api/inventory/catalogue', STAFF, lambda e, p, b, k: inventory.catalogue())
route('POST', '/api/inventory/products', STAFF, lambda e, p, b, k: inventory.create_product(k, actor(e), b))
route('PATCH', '/api/inventory/products/([^/]+)', OWNER, lambda e, p, b, k: inventory.edit_product(k, p[0], actor(e), b))
route('POST', '/api/inventory/products/([^/]+)/archive', OWNER, lambda e, p, b, k: inventory.archive_product(k, p[0], actor(e), b))
route('GET', '/api/inventory/movements', STAFF, lambda e, p, b, k: inventory.movements())
route('POST', '/api/inventory/movements', STAFF, lambda e, p, b, k: inventory.record_movement(k, actor(e), b))
route('GET', '/api/inventory/people', STAFF, lambda e, p, b, k: inventory.people())
route('POST', '/api/inventory/people', OWNER, lambda e, p, b, k: inventory.add_person(k, actor(e), b))
route('DELETE', '/api/inventory/people/([^/]+)', OWNER, lambda e, p, b, k: inventory.remove_person(p[0]))
route('GET', '/api/inventory/people/([^/]+)/handovers', STAFF, lambda e, p, b, k: inventory.handovers(p[0]))
route('GET', '/api/inventory/analysis', OWNER, lambda e, p, b, k: inventory.analysis(
    q(e, 'from'), q(e, 'until'), q(e, 'search'), q(e, 'category'), q(e, 'archived', 'true') != 'false', int(q(e, 'page', '0') or 0)))
route('GET', '/api/inventory/analysis/daily', OWNER, lambda e, p, b, k: inventory.daily(q(e, 'from'), q(e, 'until')))
route('POST', '/api/inventory/analysis/forecast/history', OWNER, lambda e, p, b, k: forecast.export_history(actor(e)))
route('GET', '/api/forecast', OWNER, lambda e, p, b, k: forecast.current())
route('GET', '/api/workshop/jobs', STAFF, lambda e, p, b, k: workshop.jobs())
route('POST', '/api/workshop/jobs', STAFF, lambda e, p, b, k: workshop.create_job(k, actor(e), b))
route('GET', '/api/workshop/archive', OWNER, lambda e, p, b, k: workshop.archive())
route('GET', '/api/workshop/jobs/([^/]+)', STAFF, lambda e, p, b, k: workshop.get_job(p[0], actor(e), 'OWNER' in groups(e)))
route('PATCH', '/api/workshop/jobs/([^/]+)', STAFF, lambda e, p, b, k: workshop.save_job(p[0], k, actor(e), b, 'OWNER' in groups(e)))
route('POST', '/api/workshop/jobs/([^/]+)/invoice', STAFF, lambda e, p, b, k: workshop.finalise(p[0], k, actor(e), b))
route('POST', '/api/workshop/jobs/([^/]+)/archive', OWNER, lambda e, p, b, k: workshop.archive_job(p[0], k, actor(e), b))
route('POST', '/api/workshop/jobs/([^/]+)/restore', OWNER, lambda e, p, b, k: workshop.restore_job(p[0], k, actor(e), b))
route('POST', '/api/workshop/jobs/([^/]+)/undo', STAFF, lambda e, p, b, k: workshop.undo_job(p[0], k, actor(e), b, 'OWNER' in groups(e)))
route('POST', '/api/workshop/jobs/([^/]+)/delete-request', STAFF, lambda e, p, b, k: workshop.request_delete(p[0], k, actor(e), b))
route('POST', '/api/workshop/jobs/([^/]+)/delete-request/reject', OWNER, lambda e, p, b, k: workshop.reject_delete(p[0], k, actor(e), b))
route('POST', '/api/workshop/jobs/([^/]+)/cancel', OWNER, lambda e, p, b, k: workshop.cancel_job(p[0], k, actor(e), b))
route('POST', '/api/workshop/photos', STAFF, lambda e, p, b, k: photos.save(b))
route('GET', '/api/workshop/photos/([0-9a-f]{32})', STAFF, lambda e, p, b, k: photos.read(p[0], q(e, 'size', 'thumb')))
route('POST', '/api/workshop/jobs/([^/]+)/photos', STAFF, lambda e, p, b, k: workshop.job_photos(p[0], k, actor(e), b))
route('GET', '/api/workshop/invoices', STAFF, lambda e, p, b, k: workshop.invoices())
route('GET', '/api/workshop/invoices/([^/]+)', STAFF, lambda e, p, b, k: workshop.get_invoice(p[0]))
route('GET', '/api/workshop/invoices/([^/]+)/pdf', STAFF, lambda e, p, b, k: ('pdf',) + workshop.pdf(p[0]))
route('POST', '/api/workshop/invoices/([^/]+)/payments', STAFF, lambda e, p, b, k: workshop.pay(p[0], k, actor(e), b))
route('POST', '/api/workshop/invoices/([^/]+)/void', OWNER, lambda e, p, b, k: workshop.void_invoice(p[0], k, actor(e), b))
route('GET', '/api/workshop/vehicles', STAFF, lambda e, p, b, k: workshop.vehicles(q(e, 'search')))
route('GET', '/api/workshop/vehicles/([^/]+)', STAFF, lambda e, p, b, k: workshop.vehicle(p[0]))
route('GET', '/api/workshop/vehicles/([^/]+)/history.pdf', STAFF, lambda e, p, b, k: ('pdf',) + workshop.vehicle_pdf(p[0]))
route('PATCH', '/api/workshop/vehicles/([^/]+)', STAFF, lambda e, p, b, k: workshop.edit_vehicle(p[0], k, actor(e), b))
route('GET', '/api/workshop/service-due', STAFF, lambda e, p, b, k: workshop.service_due())
route('GET', '/api/workshop/dashboard', STAFF, lambda e, p, b, k: workshop.dashboard())
route('GET', '/api/workshop/suggestions', STAFF, lambda e, p, b, k: workshop.suggestions())
route('GET', '/api/workshop/settings', STAFF, lambda e, p, b, k: workshop.business())
route('PUT', '/api/workshop/settings', OWNER, lambda e, p, b, k: workshop.save_business(k, actor(e), b))
route('GET', '/api/workshop/report', OWNER, lambda e, p, b, k: workshop.report(q(e, 'from'), q(e, 'until')))
route('GET', '/api/workshop/report.pdf', OWNER, lambda e, p, b, k: ('pdf',) + workshop.report_pdf(q(e, 'from'), q(e, 'until')))

HEADERS = {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}


def reply(status, payload, headers=None):
    return {'statusCode': status, 'headers': {**HEADERS, **(headers or {})}, 'body': dumps(payload)}


def scheduled(event):
    job = event.get('job')
    if job == 'forecast-export':
        return forecast.export_history()
    raise ValueError('Unknown job')


def handler(event, _context=None):
    if 'requestContext' not in event or 'http' not in event.get('requestContext', {}):
        return scheduled(event)
    http = event['requestContext']['http']
    method, path = http['method'], event.get('rawPath', '')
    try:
        for verb, pattern, roles, fn, _, _ in ROUTES:
            match = pattern.match(path)
            if verb != method or not match:
                continue
            if roles:
                require(event, *roles)
            elif not groups(event):
                raise ApiError(403, 'Staff access is required')
            raw = event.get('body') or ''
            if event.get('isBase64Encoded') and raw:
                raw = base64.b64decode(raw).decode()
            try:
                body = json.loads(raw) if raw else {}
            except ValueError:
                raise bad('The request body must be JSON') from None
            if not isinstance(body, dict):
                raise bad('The request body must be a JSON object')
            headers = {k.lower(): v for k, v in (event.get('headers') or {}).items()}
            result = fn(event, match.groups(), body, headers.get('idempotency-key'))
            if isinstance(result, tuple) and result[0] == 'pdf':
                name = re.sub(r'[^A-Za-z0-9_-]', '', result[2]) or 'document'
                return reply(200, {'filename': name + '.pdf', 'pdf': base64.b64encode(result[1]).decode()})
            return reply(200, result)
        raise ApiError(404, 'Not found')
    except ApiError as error:
        return reply(error.status, {'message': error.message})
    except Exception:  # never leak internals; the log keeps the trace for CloudWatch
        traceback.print_exc()
        return reply(500, {'message': 'The service is unavailable. Keep this form open and retry.'})
