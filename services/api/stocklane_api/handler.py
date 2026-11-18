"""Lambda entry point: an HTTP API (payload v2) router plus the scheduled jobs.

Sign-in is checked by the API Gateway JWT authorizer (Cognito); this code checks the role
(OWNER or MECHANIC) from the verified token for every route.
"""
import base64
import json
import re
import traceback

from . import alerts, bookscheck, cashup, core, links, monthly, slowstock, customers, forecast, inventory, messages, orders, payables, perms, claims, ownermail, photos, platform, quotes, staff, suppliers, workshop
from .core import ApiError, actor, bad, dumps, groups, remember_email, require

OWNER, STAFF = ('OWNER',), perms.ROLES  # OWNER: the owner only. STAFF: anyone who works in the shop (reads everyone needs)


class Open(str):
    """A route anyone can call with no sign-in (the customer's own link). It must do its own checking and never touch another shop's data."""


class P(str):
    """A route that needs one named permission (see perms.py); the owner decides which roles have it."""


def sees_cost(e):
    return perms.can(e, 'see_cost')


def is_owner(e):
    return 'OWNER' in groups(e)

PLATFORM = ('PLATFORM',)  # the person who runs this deployment: opens and closes workshops, sees none of their data
ROUTES = []


def source(e):
    return ((e.get('requestContext') or {}).get('http') or {}).get('sourceIp') or 'unknown'


def route(method, pattern, roles, fn, needs_key=False, body=False):
    ROUTES.append((method, re.compile('^' + pattern + '$'), roles, fn, needs_key, body))


def q(event, name, default=''):
    return (event.get('queryStringParameters') or {}).get(name, default)


def session(e, p, b, k):
    remember_email(actor(e), q(e, 'email'))
    return {'name': actor(e), 'roles': ['ROLE_' + g for g in sorted(groups(e))], 'shop': core.shop(), 'permissions': sorted(perms.of(e))}


route('GET', '/api/inventory/session', None, session)
route('GET', '/api/platform/shops', PLATFORM, lambda e, p, b, k: platform.shops())
route('POST', '/api/platform/shops', PLATFORM, lambda e, p, b, k: platform.create(b))
route('POST', '/api/platform/shops/([a-z0-9-]+)/suspend', PLATFORM, lambda e, p, b, k: platform.suspend(p[0], b))
route('POST', '/api/inventory/stores/standard', P('lists'), lambda e, p, b, k: inventory.stores_standard(k, actor(e), platform.STANDARD_CATEGORIES))
route('GET', '/api/inventory/products', STAFF, lambda e, p, b, k: inventory.products(sees_cost(e)))
route('GET', '/api/inventory/products/archived', P('item_edit'), lambda e, p, b, k: inventory.archived_products())
route('GET', '/api/inventory/catalogue', STAFF, lambda e, p, b, k: inventory.catalogue())
route('POST', '/api/inventory/products', P('item_add'), lambda e, p, b, k: inventory.create_product(k, actor(e), b))
route('PATCH', '/api/inventory/products/([^/]+)', P('item_edit'), lambda e, p, b, k: inventory.edit_product(k, p[0], actor(e), b))
route('POST', '/api/inventory/products/([^/]+)/price', P('price_edit'), lambda e, p, b, k: (perms.need(e, 'see_cost') if 'markupPct' in b else None, inventory.set_price(k, p[0], actor(e), b))[1])
route('GET', '/api/inventory/products/([^/]+)/price-history', P('price_edit'), lambda e, p, b, k: inventory.price_history(p[0]))
route('GET', '/api/inventory/price-review', P('see_cost'), lambda e, p, b, k: inventory.price_review())
route('POST', '/api/inventory/price-review', P('price_edit'), lambda e, p, b, k: inventory.apply_prices(k, actor(e), b))
route('POST', '/api/inventory/products/([^/]+)/archive', P('item_edit'), lambda e, p, b, k: inventory.archive_product(k, p[0], actor(e), b))
route('POST', '/api/inventory/labels/pdf', STAFF, lambda e, p, b, k: ('pdf',) + workshop.labels_pdf(b))
route('GET', '/api/inventory/movements/([^/]+)/note.pdf', STAFF, lambda e, p, b, k: ('pdf',) + workshop.stock_note_pdf(p[0], sees_cost(e) and q(e, 'cost') == '1'))
route('GET', '/api/inventory/stores/shelf', STAFF, lambda e, p, b, k: inventory.shelf_parts(q(e, 'rack'), q(e, 'level')))
route('GET', '/api/inventory/stores/layout', STAFF, lambda e, p, b, k: inventory.layout_view())
route('POST', '/api/inventory/products/import', P('item_add'), lambda e, p, b, k: inventory.import_products(k, actor(e), b))
route('POST', '/api/inventory/stores/count', P('stock_count'), lambda e, p, b, k: inventory.shelf_count(k, actor(e), b))
route('POST', '/api/inventory/stores/move', P('shelf_move'), lambda e, p, b, k: inventory.shelf_move(k, actor(e), b))
route('PUT', '/api/inventory/stores/layout', P('lists'), lambda e, p, b, k: inventory.layout_save(k, actor(e), b))
route('POST', '/api/inventory/stores/quick-start', P('lists'), lambda e, p, b, k: inventory.quick_start(k, actor(e), b))
route('GET', '/api/inventory/stores', STAFF, lambda e, p, b, k: inventory.stores_view())
route('PUT', '/api/inventory/stores', P('lists'), lambda e, p, b, k: inventory.stores_save(k, actor(e), b))
route('POST', '/api/inventory/stores/rename', P('lists'), lambda e, p, b, k: inventory.stores_rename(actor(e), b))
route('POST', '/api/inventory/stores/add', P('lists'), lambda e, p, b, k: inventory.stores_add(k, actor(e), b))
route('POST', '/api/inventory/movements/([^/]+)/cost', P('cost_edit'), lambda e, p, b, k: inventory.set_cost(k, p[0], actor(e), b))
route('GET', '/api/inventory/movements', STAFF, lambda e, p, b, k: inventory.movements(sees_cost(e)))
def movement(e, p, b, k):
    # which permission a movement needs depends on its kind; a shelf-count correction is its own, stricter one
    perms.need(e, {'RECEIPT': 'stock_in', 'OPENING': 'stock_in', 'COUNT': 'stock_count'}.get(b.get('kind'), 'stock_out'))
    result = inventory.record_movement(k, actor(e), b)
    return result if sees_cost(e) else inventory.hide_cost(result)


def document(e, p, b, k):
    if b.get('kind') == 'SUPPLIER_RETURN':
        raise bad('Use Send back to supplier for that')
    perms.need(e, 'stock_in' if b.get('kind') == 'RECEIPT' else 'stock_out')
    result = inventory.record_document(k, actor(e), b)
    return result if sees_cost(e) else inventory.hide_cost(result)


def dashboard(e, p, b, k):
    out = workshop.dashboard()
    if not perms.can(e, 'see_sales'):  # how much the shop took today is not for everyone
        for key in ('today', 'month'):
            out[key] = dict(out[key], billed=0, received=0, invoices=0)
        out['sales_hidden'] = True
    return out


route('POST', '/api/inventory/movements', STAFF, movement)
route('POST', '/api/inventory/documents', STAFF, document)
route('POST', '/api/inventory/supplier-returns', P('supplier_return'), lambda e, p, b, k: inventory.record_document(k, actor(e), dict(b, kind='SUPPLIER_RETURN')))
route('GET', '/api/inventory/payables', P('supplier_pay'), lambda e, p, b, k: payables.summary())
route('GET', '/api/inventory/suppliers/([^/]+)/payables', P('supplier_pay'), lambda e, p, b, k: payables.books(p[0]))
route('POST', '/api/inventory/suppliers/([^/]+)/payments', P('supplier_pay'), lambda e, p, b, k: payables.pay(p[0], k, actor(e), b))
route('POST', '/api/inventory/suppliers/([^/]+)/payments/([^/]+)/void', P('supplier_pay'), lambda e, p, b, k: payables.void_payment(p[0], p[1], k, actor(e), b))
route('POST', '/api/inventory/wants', P('job_stock'), lambda e, p, b, k: orders.want_add(k, actor(e), b))
route('POST', '/api/inventory/wants/([^/]+)/cancel', P('orders'), lambda e, p, b, k: orders.want_cancel(p[0], k, actor(e), b))
route('GET', '/api/inventory/to-order', P('orders'), lambda e, p, b, k: orders.to_order())
route('GET', '/api/inventory/orders', P('orders'), lambda e, p, b, k: orders.orders(q(e, 'status')))
route('POST', '/api/inventory/orders', P('orders'), lambda e, p, b, k: orders.make(k, actor(e), b))
route('GET', '/api/inventory/orders/([^/]+)', P('orders'), lambda e, p, b, k: orders.order(p[0]))
route('POST', '/api/inventory/orders/([^/]+)/close', P('orders'), lambda e, p, b, k: orders.close(p[0], k, actor(e), b))
route('GET', '/api/inventory/claims', P('suppliers_view'), lambda e, p, b, k: claims.listing(q(e, 'status'), q(e, 'supplier')))
route('POST', '/api/inventory/claims', P('supplier_return'), lambda e, p, b, k: claims.create(k, actor(e), b))
route('GET', '/api/inventory/claims/([^/]+)', P('suppliers_view'), lambda e, p, b, k: claims.get_claim(p[0]))
route('POST', '/api/inventory/claims/([^/]+)/status', P('supplier_return'), lambda e, p, b, k: claims.set_status(p[0], k, actor(e), b))
route('GET', '/api/inventory/suppliers', P('suppliers_view'), lambda e, p, b, k: suppliers.suppliers(q(e, 'search'), q(e, 'kind'), q(e, 'inactive') == '1'))
route('POST', '/api/inventory/suppliers', P('suppliers_edit'), lambda e, p, b, k: suppliers.create(k, actor(e), b))
route('GET', '/api/inventory/suppliers/([^/]+)', P('suppliers_view'), lambda e, p, b, k: suppliers.supplier(p[0], sees_cost(e)))
route('PATCH', '/api/inventory/suppliers/([^/]+)', P('suppliers_edit'), lambda e, p, b, k: suppliers.edit(p[0], k, actor(e), b))
route('GET', '/api/inventory/people', STAFF, lambda e, p, b, k: inventory.people())
route('POST', '/api/inventory/people', P('people'), lambda e, p, b, k: inventory.add_person(k, actor(e), b))
route('DELETE', '/api/inventory/people/([^/]+)', P('people'), lambda e, p, b, k: inventory.remove_person(p[0]))
route('GET', '/api/inventory/people/([^/]+)/handovers', STAFF, lambda e, p, b, k: inventory.handovers(p[0]))
route('GET', '/api/inventory/analysis', P('reports'), lambda e, p, b, k: inventory.analysis(
    q(e, 'from'), q(e, 'until'), q(e, 'search'), q(e, 'category'), q(e, 'archived', 'true') != 'false', int(q(e, 'page', '0') or 0)))
route('GET', '/api/inventory/analysis.pdf', P('reports'), lambda e, p, b, k: ('pdf',) + workshop.stock_report_pdf(q(e, 'from'), q(e, 'until'), q(e, 'search'), q(e, 'category')))
route('GET', '/api/inventory/analysis/daily', P('reports'), lambda e, p, b, k: inventory.daily(q(e, 'from'), q(e, 'until')))
route('POST', '/api/inventory/analysis/forecast/history', P('reports'), lambda e, p, b, k: forecast.export_history(actor(e)))
route('GET', '/api/forecast', P('reports'), lambda e, p, b, k: forecast.current())
route('GET', '/api/workshop/jobs', P('jobs_view'), lambda e, p, b, k: workshop.jobs())
route('POST', '/api/workshop/jobs', P('jobs'), lambda e, p, b, k: workshop.create_job(k, actor(e), b))
route('GET', '/api/workshop/archive', P('archive'), lambda e, p, b, k: workshop.archive())
route('GET', '/api/workshop/jobs/([^/]+)', P('jobs_view'), lambda e, p, b, k: workshop.get_job(p[0], actor(e), is_owner(e) or perms.can(e, 'archive')))
route('PATCH', '/api/workshop/jobs/([^/]+)', P('jobs'), lambda e, p, b, k: workshop.save_job(p[0], k, actor(e), b, is_owner(e)))
route('POST', '/api/workshop/jobs/([^/]+)/stock-batch', P('job_stock'), lambda e, p, b, k: workshop.use_stock_batch(p[0], k, actor(e), b))
route('POST', '/api/workshop/jobs/([^/]+)/stock', P('job_stock'), lambda e, p, b, k: workshop.use_stock(p[0], k, actor(e), b))
route('POST', '/api/workshop/jobs/([^/]+)/invoice', P('bill'), lambda e, p, b, k: workshop.finalise(p[0], k, actor(e), b))
route('POST', '/api/workshop/jobs/([^/]+)/archive', P('archive'), lambda e, p, b, k: workshop.archive_job(p[0], k, actor(e), b))
route('POST', '/api/workshop/jobs/([^/]+)/restore', P('archive'), lambda e, p, b, k: workshop.restore_job(p[0], k, actor(e), b))
route('POST', '/api/workshop/jobs/([^/]+)/undo', P('jobs'), lambda e, p, b, k: workshop.undo_job(p[0], k, actor(e), b, is_owner(e) or perms.can(e, 'archive')))
route('POST', '/api/workshop/jobs/([^/]+)/stage', P('jobs'), lambda e, p, b, k: workshop.set_stage(p[0], k, actor(e), b))
route('POST', '/api/workshop/jobs/([^/]+)/delete-request', P('jobs'), lambda e, p, b, k: workshop.request_delete(p[0], k, actor(e), b))
route('POST', '/api/workshop/jobs/([^/]+)/delete-request/reject', P('archive'), lambda e, p, b, k: workshop.reject_delete(p[0], k, actor(e), b))
route('POST', '/api/workshop/jobs/([^/]+)/cancel', P('archive'), lambda e, p, b, k: workshop.cancel_job(p[0], k, actor(e), b))
route('GET', '/api/workshop/quotes', P('jobs_view'), lambda e, p, b, k: quotes.quotes())
route('POST', '/api/workshop/quotes', P('quotes'), lambda e, p, b, k: quotes.create(k, actor(e), b))
route('GET', '/api/workshop/quotes/([^/]+)', P('jobs_view'), lambda e, p, b, k: quotes.get_quote(p[0]))
route('PATCH', '/api/workshop/quotes/([^/]+)', P('quotes'), lambda e, p, b, k: quotes.save(p[0], k, actor(e), b))
route('POST', '/api/workshop/quotes/([^/]+)/revise', P('quotes'), lambda e, p, b, k: quotes.revise(p[0], k, actor(e), b))
route('POST', '/api/workshop/quotes/([^/]+)/status', P('quotes_approve'), lambda e, p, b, k: quotes.set_status(p[0], k, actor(e), b))
route('POST', '/api/workshop/quotes/([^/]+)/convert', P('quotes_approve'), lambda e, p, b, k: quotes.convert(p[0], k, actor(e), b))
route('DELETE', '/api/workshop/quotes/([^/]+)', P('quotes_approve'), lambda e, p, b, k: quotes.remove(p[0], k, actor(e), b))
route('GET', '/api/workshop/logo', STAFF, lambda e, p, b, k: workshop.logo_image())
route('PUT', '/api/workshop/logo', P('settings'), lambda e, p, b, k: workshop.save_logo(k, actor(e), b))
route('DELETE', '/api/workshop/logo', P('settings'), lambda e, p, b, k: workshop.remove_logo(k, actor(e), b))
route('POST', '/api/workshop/photos', STAFF, lambda e, p, b, k: photos.save(b))
route('GET', '/api/workshop/photos/([0-9a-f]{32})', STAFF, lambda e, p, b, k: photos.read(p[0], q(e, 'size', 'thumb')))
route('POST', '/api/workshop/jobs/([^/]+)/photos', P('jobs'), lambda e, p, b, k: workshop.job_photos(p[0], k, actor(e), b))
route('POST', '/api/workshop/quick-bill', P('bill'), lambda e, p, b, k: (perms.need(e, 'jobs'), perms.need(e, 'job_stock'), workshop.quick_bill(k, actor(e), b, is_owner(e)))[2])
route('GET', '/api/workshop/invoices', P('bills_view'), lambda e, p, b, k: workshop.invoices())
route('GET', '/api/workshop/invoices/([^/]+)', P('bills_view'), lambda e, p, b, k: workshop.get_invoice(p[0]))
route('GET', '/api/workshop/invoices/([^/]+)/pdf', P('bills_view'), lambda e, p, b, k: ('pdf',) + workshop.pdf(p[0]))
route('GET', '/api/workshop/invoices/([^/]+)/returns/([^/]+)/pdf', P('bills_view'), lambda e, p, b, k: ('pdf',) + workshop.return_note_pdf(p[0], p[1]))
route('POST', '/api/workshop/invoices/([^/]+)/payments', P('bill'), lambda e, p, b, k: workshop.pay(p[0], k, actor(e), b))
route('POST', '/api/workshop/invoices/([^/]+)/refund', P('void_refund'), lambda e, p, b, k: workshop.refund(p[0], k, actor(e), b))
route('POST', '/api/workshop/invoices/([^/]+)/return', P('void_refund'), lambda e, p, b, k: workshop.return_parts(p[0], k, actor(e), b))
route('POST', '/api/workshop/invoices/([^/]+)/void', P('void_refund'), lambda e, p, b, k: workshop.void_invoice(p[0], k, actor(e), b))
route('GET', '/api/workshop/vehicles', P('jobs_view'), lambda e, p, b, k: workshop.vehicles(q(e, 'search')))
route('GET', '/api/workshop/vehicles/([^/]+)', P('jobs_view'), lambda e, p, b, k: workshop.vehicle(p[0]))
route('GET', '/api/workshop/vehicles/([^/]+)/history.pdf', P('jobs_view'), lambda e, p, b, k: ('pdf',) + workshop.vehicle_pdf(p[0]))
route('PATCH', '/api/workshop/vehicles/([^/]+)', P('vehicles'), lambda e, p, b, k: workshop.edit_vehicle(p[0], k, actor(e), b))
route('POST', '/api/workshop/vehicles/([^/]+)/owner', P('vehicles'), lambda e, p, b, k: workshop.new_owner(p[0], k, actor(e), b))
route('GET', '/api/workshop/customers/lookup', P('jobs'), lambda e, p, b, k: customers.lookup(q(e, 'search')))
route('GET', '/api/workshop/customers', P('customers_view'), lambda e, p, b, k: customers.customers(q(e, 'search'), q(e, 'inactive') == '1'))
route('POST', '/api/workshop/customers', P('customers_edit'), lambda e, p, b, k: customers.create(k, actor(e), b))
route('GET', '/api/workshop/customers/([^/]+)', P('customers_view'), lambda e, p, b, k: customers.customer(p[0]))
route('PATCH', '/api/workshop/customers/([^/]+)', P('customers_edit'), lambda e, p, b, k: customers.edit(p[0], k, actor(e), b))
route('POST', '/api/workshop/customers/([^/]+)/merge', P('customers_edit'), lambda e, p, b, k: customers.merge(p[0], k, actor(e), b))
route('GET', '/api/workshop/customers/([^/]+)/statement.pdf', P('customers_view'), lambda e, p, b, k: ('pdf',) + customers.statement_pdf(p[0]))
route('GET', '/api/workshop/owing', P('bills_view'), lambda e, p, b, k: workshop.owing(q(e, 'reg') or '', q(e, 'phone') or ''))
route('GET', '/api/workshop/messages', P('messages'), lambda e, p, b, k: messages.rows(q(e, 'origin')))
route('GET', '/api/workshop/messages/count', P('messages'), lambda e, p, b, k: messages.count())
route('GET', '/api/workshop/messages/history', P('messages'), lambda e, p, b, k: messages.history())
route('GET', '/api/workshop/messages/templates', P('messages'), lambda e, p, b, k: messages.templates_view())
route('PUT', '/api/workshop/messages/templates', P('settings'), lambda e, p, b, k: messages.save_templates(k, actor(e), b))
route('POST', '/api/workshop/messages/log', P('messages'), lambda e, p, b, k: messages.log(k, actor(e), b))
route('GET', '/api/workshop/service-due', P('jobs_view'), lambda e, p, b, k: workshop.service_due())
route('GET', '/api/workshop/slow-stock', P('reports'), lambda e, p, b, k: slowstock.slow(slowstock.parse_days(q(e, 'days')), q(e, 'category') or ''))
route('GET', '/api/workshop/monthly.pdf', P('reports'), lambda e, p, b, k: ('pdf',) + monthly.pdf(q(e, 'month')))
route('GET', '/api/workshop/quotes/([^/]+)/link', P('quotes'), lambda e, p, b, k: links.current(p[0], 'quote'))
route('POST', '/api/workshop/quotes/([^/]+)/link', P('quotes'), lambda e, p, b, k: links.create(p[0], k, actor(e), b, 'quote'))
route('POST', '/api/workshop/quotes/([^/]+)/link/revoke', P('quotes'), lambda e, p, b, k: links.revoke(p[0], k, actor(e), b, 'quote'))
route('POST', '/api/public/track/([A-Za-z0-9~_-]{1,120})/decision', Open(), lambda e, p, b, k: links.decide(p[0], b, source(e)))
route('GET', '/api/workshop/jobs/([^/]+)/link', P('jobs_view'), lambda e, p, b, k: links.current(p[0]))
route('POST', '/api/workshop/jobs/([^/]+)/link', P('jobs'), lambda e, p, b, k: links.create(p[0], k, actor(e), b))
route('POST', '/api/workshop/jobs/([^/]+)/link/revoke', P('jobs'), lambda e, p, b, k: links.revoke(p[0], k, actor(e), b))
route('GET', '/api/public/track/([A-Za-z0-9~_-]{1,120})', Open(), lambda e, p, b, k: links.view(p[0], source(e)))
route('GET', '/api/public/track/([A-Za-z0-9~_-]{1,120})/photo/([0-9a-f]{32})', Open(), lambda e, p, b, k: links.photo(p[0], p[1], source(e)))
route('GET', '/api/workshop/cockpit', P('alerts'), lambda e, p, b, k: alerts.cockpit())
route('GET', '/api/workshop/alerts', P('alerts'), lambda e, p, b, k: alerts.listing())
route('POST', '/api/workshop/alerts/seen', P('alerts'), lambda e, p, b, k: alerts.mark_seen(k, actor(e), b))
route('GET', '/api/workshop/dashboard', P('jobs_view'), dashboard)
route('GET', '/api/workshop/suggestions', P('jobs_view'), lambda e, p, b, k: workshop.suggestions())
route('GET', '/api/workshop/staff', OWNER, lambda e, p, b, k: staff.staff())
route('POST', '/api/workshop/staff', OWNER, lambda e, p, b, k: staff.invite(b))
route('POST', '/api/workshop/staff/([^/]+)/role', OWNER, lambda e, p, b, k: staff.set_role(p[0], actor(e), b))
route('DELETE', '/api/workshop/staff/([^/]+)', OWNER, lambda e, p, b, k: staff.remove(p[0], actor(e)))
route('GET', '/api/workshop/permissions', OWNER, lambda e, p, b, k: perms.view())
route('PUT', '/api/workshop/permissions', OWNER, lambda e, p, b, k: perms.save(k, actor(e), b))
route('GET', '/api/workshop/settings', STAFF, lambda e, p, b, k: workshop.business() if sees_cost(e) else {x: y for x, y in workshop.business().items() if x != 'default_markup_pct'})
route('GET', '/api/workshop/owner-mail', OWNER, lambda e, p, b, k: ownermail.view())
route('PUT', '/api/workshop/owner-mail', OWNER, lambda e, p, b, k: ownermail.save(k, actor(e), b))
route('POST', '/api/workshop/owner-mail/test', OWNER, lambda e, p, b, k: ownermail.send_test(actor(e)))
route('PUT', '/api/workshop/settings', P('settings'), lambda e, p, b, k: workshop.save_business(k, actor(e), b))
route('GET', '/api/workshop/cashup', P('cash_up'), lambda e, p, b, k: cashup.view(q(e, 'date')))
route('GET', '/api/workshop/cashup/history', P('cash_up'), lambda e, p, b, k: cashup.history())
route('POST', '/api/workshop/cashup', P('cash_up'), lambda e, p, b, k: cashup.close(k, actor(e), b))
route('POST', '/api/workshop/cashup/reopen', OWNER, lambda e, p, b, k: cashup.reopen(k, actor(e), b))
route('GET', '/api/workshop/books-check', P('reports'), lambda e, p, b, k: bookscheck.run())
route('GET', '/api/workshop/export', P('export'), lambda e, p, b, k: workshop.export_all())
route('GET', '/api/workshop/report', P('reports'), lambda e, p, b, k: workshop.report(q(e, 'from'), q(e, 'until')))
route('GET', '/api/workshop/report.pdf', P('reports'), lambda e, p, b, k: ('pdf',) + workshop.report_pdf(q(e, 'from'), q(e, 'until')))

HEADERS = {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}


def reply(status, payload, headers=None):
    return {'statusCode': status, 'headers': {**HEADERS, **(headers or {})}, 'body': dumps(payload)}


def scheduled(event):
    job = event.get('job')
    if job == 'forecast-export':
        out = {}
        for shop in core.shops():  # one export per shop, each from its own rows
            core.set_shop(shop)
            out[shop] = forecast.export_history()
        return out
    if job == 'daily-summary':
        out = {}
        for shop in core.shops():  # each shop that turned it on gets its own mail, built from its own rows
            core.set_shop(shop)
            try:
                out[shop] = ownermail.run_daily()
            except Exception as e:  # noqa: BLE001 - one shop's problem must not stop the others
                out[shop] = {'sent': False, 'error': str(e)[:120]}
        return out
    raise ValueError('Unknown job')


PRIVATE = ('outside_cost', 'outside_shop', 'outside_supplier_id', 'cost_each', 'profit')  # only for people with the see-cost permission


def hide_private(value):
    """Remove the owner-only fields anywhere in a reply (jobs, invoices, lists)."""
    if isinstance(value, dict):
        return {k: hide_private(v) for k, v in value.items() if k not in PRIVATE}
    if isinstance(value, list):
        return [hide_private(v) for v in value]
    return value


def handler(event, _context=None):
    if 'requestContext' not in event or 'http' not in event.get('requestContext', {}):
        return scheduled(event)
    http = event['requestContext']['http']
    method, path = http['method'], event.get('rawPath', '')
    core.no_shop()
    try:
        for verb, pattern, roles, fn, _, _ in ROUTES:
            match = pattern.match(path)
            if verb != method or not match:
                continue
            if isinstance(roles, Open):  # the customer's own link: no sign-in, the token inside it names the one shop and job
                raw = event.get('body') or ''
                if len(raw) > 2000:
                    raise bad('That is too long')
                try:
                    given = json.loads(raw) if raw else {}
                except ValueError:
                    raise bad('The request body must be JSON') from None
                return reply(200, fn(event, match.groups(), given if isinstance(given, dict) else {}, None), {'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'})
            if roles == PLATFORM:  # the register of shops is outside every shop
                require(event, *roles)
            else:
                core.set_shop(core.shop_of(event))  # before any data is read: everything below sees this shop only
                platform.admit(core.shop())
            if isinstance(roles, P):
                perms.need(event, roles)
            elif roles and roles != PLATFORM:
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
            if not (isinstance(result, tuple) and result[0] == 'pdf') and not sees_cost(event):
                result = hide_private(result)  # what a part bought outside cost, and where, is for the owner
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
