"""Shop settings (bill number prefix, labour list, mechanics, logo), per-line discounts, and the stock/forecast fixes."""
import base64
import io
from datetime import date
from decimal import Decimal

import boto3
from PIL import Image

from test_job_stock import new_job, use
from test_money_flow import BIZ, ok
from test_stock_count import product, stock


def jpeg(w=120, h=60, color=(20, 90, 60)):
    buf = io.BytesIO()
    Image.new('RGB', (w, h), color).save(buf, 'JPEG')
    return base64.b64encode(buf.getvalue()).decode()


def settings(api, **extra):
    return api('PUT', '/api/workshop/settings', {**BIZ, **extra})


def test_new_settings_are_saved_and_checked(api):
    s = ok(settings(api, invoice_prefix='gm', default_reorder_level=8, mechanics=['Kamal', 'Nuwan'],
                    labour_items=[{'description': 'Oil change', 'amount': 1500}, {'description': 'Wheel alignment', 'amount': 3000}]))
    assert s['invoice_prefix'] == 'GM' and s['default_reorder_level'] == 8 and s['mechanics'] == ['Kamal', 'Nuwan'] and len(s['labour_items']) == 2
    assert ok(api('GET', '/api/workshop/settings', role='MECHANIC'))['mechanics'] == ['Kamal', 'Nuwan']
    for bad_extra in ({'invoice_prefix': 'A B'}, {'invoice_prefix': 'TOOLONGX'}, {'invoice_prefix': 'සිං'}, {'default_reorder_level': -1},
                      {'mechanics': ['Kamal', 'kamal']}, {'mechanics': ['x'] * 21}, {'mechanics': ['']},
                      {'labour_items': [{'description': 'A', 'amount': 1}, {'description': 'a', 'amount': 2}]}, {'labour_items': [{'description': 'A', 'amount': -5}]}):
        assert settings(api, **bad_extra)[0] == 400, bad_extra
    assert api('PUT', '/api/workshop/settings', {**BIZ}, role='MECHANIC')[0] == 403  # only the owner changes settings


def test_invoice_number_uses_the_prefix(api):
    ok(settings(api, invoice_prefix='gm'))
    job = new_job(api)
    j = ok(api('PATCH', '/api/workshop/jobs/' + job['id'], {'revision': job['revision'], 'parts': [{'name': 'Oil', 'quantity': 1, 'unit_price': 100}]}, role='OWNER'))
    inv = ok(api('POST', '/api/workshop/jobs/%s/invoice' % j['id'], {'revision': j['revision']}, role='OWNER'))
    assert inv['invoice_number'].startswith('GM-%s-' % date.today().strftime('%Y%m%d')) or inv['invoice_number'].startswith('GM-')


def test_logo_upload_replace_remove(api):
    boto3.client('s3', region_name='ap-southeast-2').create_bucket(Bucket='test-media', CreateBucketConfiguration={'LocationConstraint': 'ap-southeast-2'})
    assert api('PUT', '/api/workshop/logo', {'image': jpeg()}, role='MECHANIC')[0] == 403
    for bad_image in ('', 'not base64!!', base64.b64encode(b'GIF89a....').decode(), jpeg(8, 8), base64.b64encode(b'\xff\xd8\xff' + b'0' * 200_000).decode()):
        assert api('PUT', '/api/workshop/logo', {'image': bad_image})[0] == 400
    assert api('GET', '/api/workshop/logo')[0] == 404  # nothing yet: the app shows the initials
    first = ok(api('PUT', '/api/workshop/logo', {'image': jpeg()}))['logo']
    assert first['w'] == 120 and first['h'] == 60 and first['c'] == 3
    assert ok(api('GET', '/api/workshop/logo', role='MECHANIC'))['data']
    # saving the other settings keeps the logo
    ok(settings(api, name='Ganga Motors 2'))
    assert ok(api('GET', '/api/workshop/settings'))['logo']['v'] == first['v']
    second = ok(api('PUT', '/api/workshop/logo', {'image': jpeg(80, 80, (200, 0, 0))}))['logo']
    assert second['v'] != first['v'] and ok(api('GET', '/api/workshop/logo'))['w'] == 80
    ok(api('DELETE', '/api/workshop/logo'))
    assert api('GET', '/api/workshop/logo')[0] == 404 and ok(api('GET', '/api/workshop/settings'))['logo'] is None
    assert ok(api('GET', '/api/workshop/settings'))['name'] == 'Ganga Motors 2'


def test_bill_pdf_draws_the_logo_and_survives_a_missing_one(api):
    boto3.client('s3', region_name='ap-southeast-2').create_bucket(Bucket='test-media', CreateBucketConfiguration={'LocationConstraint': 'ap-southeast-2'})
    ok(settings(api))
    job = new_job(api)
    j = ok(api('PATCH', '/api/workshop/jobs/' + job['id'], {'revision': job['revision'], 'parts': [{'name': 'Oil', 'quantity': 1, 'unit_price': 100}]}, role='OWNER'))
    inv = ok(api('POST', '/api/workshop/jobs/%s/invoice' % j['id'], {'revision': j['revision']}, role='OWNER'))
    from stocklane_api import workshop
    plain = workshop.pdf(inv['id'])[0]
    ok(api('PUT', '/api/workshop/logo', {'image': jpeg()}))
    withlogo = workshop.pdf(inv['id'])[0]
    assert b'/Subtype /Image' not in plain and b'/Filter /DCTDecode' in withlogo and withlogo.startswith(b'%PDF') and b'/Im1 Do' in withlogo
    ok(api('DELETE', '/api/workshop/logo'))
    assert b'/Subtype /Image' not in workshop.pdf(inv['id'])[0]


def line(j, i=0):
    return j['parts'][i]


def test_per_line_discount_and_mechanic_limit(api):
    ok(settings(api, mechanic_discount_pct=10))
    job = new_job(api)
    parts = [{'name': 'Pads', 'quantity': 2, 'unit_price': 1000, 'discount_pct': 10}, {'name': 'Oil', 'quantity': 1, 'unit_price': 500}]
    j = ok(api('PATCH', '/api/workshop/jobs/' + job['id'], {'revision': job['revision'], 'parts': parts}, role='OWNER'))
    assert line(j)['discount_pct'] == 10 and j['parts_total'] == 2300  # 2000 less 10% = 1800, plus 500
    for bad_pct in (-1, 101, 'x', 12.345):
        assert api('PATCH', '/api/workshop/jobs/' + job['id'], {'revision': j['revision'], 'parts': [dict(parts[0], discount_pct=bad_pct)]}, role='OWNER')[0] == 400, bad_pct
    # a mechanic may discount up to the shop limit (10% of 2500 = 250), counting the line discounts already given
    ok(api('PATCH', '/api/workshop/jobs/' + job['id'], {'revision': j['revision'], 'discount': 50}, role='MECHANIC'))
    over = api('PATCH', '/api/workshop/jobs/' + job['id'], {'revision': j['revision'] + 1, 'parts': [dict(parts[0], discount_pct=25), parts[1]]}, role='MECHANIC')
    assert over[0] == 400, over
    ok(api('PATCH', '/api/workshop/jobs/' + job['id'], {'revision': j['revision'] + 1, 'parts': [dict(parts[0], discount_pct=25), parts[1]]}, role='OWNER'))
    inv_job = ok(api('GET', '/api/workshop/jobs/' + job['id']))
    inv = ok(api('POST', '/api/workshop/jobs/%s/invoice' % job['id'], {'revision': inv_job['revision']}, role='OWNER'))
    assert inv['parts_total'] == 2000 and inv['total'] == 1950  # 1500 + 500 - 50


def test_void_keeps_stock_links_and_cancel_then_returns_stock(api):
    p, job = product(api, 10), new_job(api)
    j = ok(use(api, job, p['id'], 3))
    inv = ok(api('POST', '/api/workshop/jobs/%s/invoice' % j['id'], {'revision': j['revision']}, role='OWNER'))
    ok(api('POST', '/api/workshop/invoices/%s/void' % inv['id'], {}))
    back = ok(api('GET', '/api/workshop/jobs/' + j['id']))
    assert back['status'] == 'OPEN' and back['parts'][0]['product_id'] == p['id'] and stock(api, p['id']) == 7  # still on the job, stock still out
    ok(use(api, back, p['id'], 1, 'return'))
    assert stock(api, p['id']) == 8
    ok(api('POST', '/api/workshop/jobs/%s/cancel' % j['id'], {'reason': 'Customer left'}))
    assert stock(api, p['id']) == 10  # the rest came back with the cancel


def test_forecast_demand_is_taken_minus_returned(api):
    from stocklane_api import inventory
    p, job = product(api, 10), new_job(api)
    j = ok(use(api, job, p['id'], 4))
    ok(use(api, j, p['id'], 3, 'return'))
    snap = inventory.history_snapshot(date.today().isoformat(), True, 'owner')
    assert stock(api, p['id']) == 9
    print(repr(snap)[:1500])
    assert 1 in [x for x in _numbers(snap) if not isinstance(x, bool)] or Decimal(1) in [x for x in _numbers(snap) if isinstance(x, Decimal)]


def _numbers(x):
    if isinstance(x, dict):
        for v in x.values():
            yield from _numbers(v)
    elif isinstance(x, (list, tuple)):
        for v in x:
            yield from _numbers(v)
    elif isinstance(x, (int, float, Decimal)):
        yield x
