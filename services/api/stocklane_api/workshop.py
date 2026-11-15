"""Workshop: vehicles, repair jobs with manual part and labour lines, invoices, payments, reports.

A part line is free text, unless the part was taken from stock (use_stock): that line carries a product_id and
its quantity only changes together with the stock, in one transaction. A job is OPEN until its invoice is
created, then INVOICED. Cancelling or deleting an open job puts its stock parts back. Every write is one transaction and edits use an optimistic revision, so
two people can never overwrite each other's work silently.

  WJOB/<id>             repair job (customer, vehicle, parts[], labour[], discount)
  VEHICLE/<REG>         one file per vehicle (owner, phone, last km, next service, notes)
  VJOB#<REG>/<iso>#<id> the vehicle's repair history (one small row per job, kept current on every save)
  WINV/<id>             invoice snapshot (with the business header of that day) + payments
  WSET/business         business name, address, bank details, footer, tax
"""
import base64
import hashlib
import re
import time
import uuid
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from . import bills, inventory, photos
from .core import COLOMBO, bad, batch_get, check, command, conflict, delete, emails, get, missing, now, num, public, put, query, update

LATIN = re.compile(r'[\x20-\x7e]*')
MONEY, ZERO, HUNDRED = Decimal('0.01'), Decimal('0'), Decimal('100')
METHODS = ('CASH', 'CARD', 'BANK', 'OTHER')
CHANGED = 'Someone changed this just now. Reload it and try again.'
DEFAULT_BUSINESS = {'name': 'Workshop Suite', 'address': '', 'phone': '', 'email': '', 'reg_no': '', 'bank': '',
                    'footer': 'Thank you for your business.', 'tax_name': 'VAT', 'tax_rate': ZERO, 'mechanic_discount_pct': Decimal('10'),
                    'payment_terms_days': 0, 'warranty': '', 'qr_url': '', 'qr_bits': '', 'invoice_prefix': 'INV', 'default_reorder_level': 5,
                    'labour_items': [], 'mechanics': [], 'logo': None}


# ---------- input checks ----------
def text(value, field, size, required=False):
    v = ' '.join(str(value or '').split())
    if required and not v:
        raise bad(field + ' is required')
    if len(v) > size:
        raise bad(field + ' is too long')
    if not LATIN.fullmatch(v):
        raise bad(field + ': use English letters and numbers (the PDFs are English only)')
    return v


def lines_text(value, field, size):
    """Multi-line text (addresses, bank details): keep line breaks, English characters only."""
    v = '\n'.join(' '.join(row.split()) for row in str(value or '').replace('\r', '').split('\n')).strip()
    if len(v) > size:
        raise bad(field + ' is too long')
    if not LATIN.fullmatch(v.replace('\n', ' ')):
        raise bad(field + ': use English letters and numbers')
    return v


def regkey(value):
    key = re.sub(r'[^A-Z0-9]', '', str(value or '').upper())
    if not 2 <= len(key) <= 12:
        raise bad('Enter the vehicle number')
    return key


def phone(value):
    v = str(value or '').strip()
    if v and not re.fullmatch(r'[0-9+()\- ]{5,20}', v):
        raise bad('The contact number does not look right')
    return v


def money(value, field):
    v = num(value, field)
    if v < 0 or v > 100_000_000 or v.as_tuple().exponent < -2:
        raise bad(field + ' must be an amount with at most 2 decimals')
    return v


def quantity(value):
    v = num(value, 'Quantity')
    if v <= 0 or v > 100_000 or v.as_tuple().exponent < -3:
        raise bad('Quantity must be more than 0 (up to 3 decimals)')
    return v


def km(value, field):
    if value in (None, ''):
        return None
    v = num(value, field)
    if v < 0 or v > 10_000_000 or v != v.to_integral_value():
        raise bad(field + ' must be a whole number of km')
    return v


def day(value, field):
    v = str(value or '').strip()
    if v:
        try:
            datetime.strptime(v, '%Y-%m-%d')
        except ValueError:
            raise bad(field + ' must be a date') from None
    return v


def rows(value, size, name):
    if not isinstance(value, list) or len(value) > size or not all(isinstance(r, dict) for r in value):
        raise bad('Check the ' + name + ' lines (at most ' + str(size) + ')')
    return value


def parts_in(value):
    out = []
    for r in rows(value, 60, 'parts'):
        line = {'name': text(r.get('name'), 'Part name', 100, True), 'quantity': quantity(r.get('quantity', 1)),
                'unit_price': money(r.get('unit_price', 0), 'Part price')}
        if r.get('product_id'):
            line['product_id'] = text(r['product_id'], 'Stock part', 64, True)
        if r.get('discount_pct') not in (None, '', 0, '0'):
            pct = num(r['discount_pct'], 'Line discount')
            if pct < 0 or pct > 100 or pct.as_tuple().exponent < -2:
                raise bad('A line discount is between 0 and 100 percent')
            if pct > 0:
                line['discount_pct'] = pct
        out.append(line)
    return out


MAX_STOCK_LINES = 12  # keeps one cancel or delete inside a single transaction


def stock_quantities(parts):
    """{product_id: quantity} of the lines taken from stock."""
    found = {}
    for p in parts:
        if p.get('product_id'):
            if p['product_id'] in found:
                raise bad('The same stock part is on this job twice')
            found[p['product_id']] = p['quantity']
    return found


def labour_in(value):
    return [{'description': text(r.get('description'), 'Labour description', 100, True),
             'amount': money(r.get('amount', 0), 'Labour amount')} for r in rows(value, 30, 'labour')]


def line_gross(p):
    return p['quantity'] * p['unit_price']


def line_total(p):
    """Quantity times price, less the line's own discount (a percent) when it has one."""
    return (line_gross(p) * (HUNDRED - p.get('discount_pct', ZERO)) / HUNDRED).quantize(MONEY, ROUND_HALF_UP)


def discount_given(j):
    """Everything taken off the bill: the bill discount plus every line discount."""
    lines = sum((line_gross(p).quantize(MONEY, ROUND_HALF_UP) - line_total(p) for p in j.get('parts', [])), ZERO)
    return j.get('discount', ZERO) + lines


def totals(j, rate=ZERO):
    """Money of a job. An invoiced job keeps the tax rate it was invoiced with."""
    rate = j.get('tax_rate', rate)
    parts = sum((line_total(p) for p in j.get('parts', [])), ZERO)
    labour = sum((l['amount'] for l in j.get('labour', [])), ZERO)
    discount = j.get('discount', ZERO)
    subtotal = parts + labour - discount
    tax = (subtotal * rate / HUNDRED).quantize(MONEY, ROUND_HALF_UP) if subtotal > 0 else ZERO
    return {'parts_total': parts, 'labour_total': labour, 'discount': discount, 'subtotal': subtotal, 'tax': tax, 'total': subtotal + tax}


def today():
    return datetime.now(COLOMBO).date()


def local_date(iso):
    return datetime.fromisoformat(iso).astimezone(COLOMBO).date()


def clean(item):
    return {k: v for k, v in item.items() if v is not None}


# ---------- business settings ----------
def business():
    return {**DEFAULT_BUSINESS, **public(get('WSET', 'business') or {})}


def qr_bits(url, packed):
    """The QR picture made by the browser ('N:' then N*N zeros and ones). Only kept when it is well formed and a link is set."""
    if not url or not packed:
        return ''
    m = re.fullmatch(r'(\d{2}):([01]+)', str(packed))
    if not m or not 21 <= int(m.group(1)) <= 77 or len(m.group(2)) != int(m.group(1)) ** 2:
        raise bad('The QR code is not valid. Save the settings again.')
    return str(packed)


PREFIX = re.compile(r'[A-Za-z0-9]{1,6}')


def shop_lists(b):
    """Bill number prefix, default reorder level, the shop's labour price list and its mechanics."""
    prefix = str(b.get('invoice_prefix') or 'INV').strip().upper()
    if not PREFIX.fullmatch(prefix):
        raise bad('The bill number prefix is 1 to 6 letters or numbers (no spaces)')
    level = num(b.get('default_reorder_level') if b.get('default_reorder_level') not in (None, '') else 5, 'Default reorder level')
    if level < 0 or level > 100_000 or level.as_tuple().exponent < -3:
        raise bad('The default reorder level must be 0 or more')
    labour, seen = [], set()
    for r in rows(b.get('labour_items') or [], 30, 'labour list'):
        row = {'description': text(r.get('description'), 'Labour description', 100, True), 'amount': money(r.get('amount', 0), 'Labour amount')}
        if row['description'].lower() in seen:
            raise bad('"%s" is in the labour list twice' % row['description'])
        seen.add(row['description'].lower())
        labour.append(row)
    names, seen = [], set()
    if not isinstance(b.get('mechanics') or [], list) or len(b.get('mechanics') or []) > 20:
        raise bad('Up to 20 mechanics')
    for n in b.get('mechanics') or []:
        name = text(n, 'Mechanic name', 60, True)
        if name.lower() in seen:
            raise bad('"%s" is in the mechanics list twice' % name)
        seen.add(name.lower())
        names.append(name)
    return {'invoice_prefix': prefix, 'default_reorder_level': level, 'labour_items': labour, 'mechanics': names}


def save_logo(key, who, body):
    """Owner only. The logo is one small JPEG made by the phone or computer; it is stored once and drawn on the bill, the PDFs and the header."""
    raw, width_, height, comps = photos.logo_check((body or {}).get('image'))
    version = hashlib.sha256(raw).hexdigest()[:32]  # the same picture always gets the same name, so a retry is a replay
    old = (get('WSET', 'business') or {}).get('logo') or {}
    photos.logo_save(raw, version)

    def build():
        stored = get('WSET', 'business') or {'pk': 'WSET', 'sk': 'business'}
        item = clean(dict(stored, logo={'v': version, 'w': width_, 'h': height, 'c': comps}, updated_at=now(), updated_by=who))
        return [put(item)], [None], {'logo': item['logo']}
    result = command(key, 'save-logo', who, {'version': version}, build)
    if old.get('v') and old.get('v') != result['logo']['v']:
        photos.logo_drop(old['v'])
    return result


def remove_logo(key, who, body):
    def build():
        stored = get('WSET', 'business') or {}
        old = (stored.get('logo') or {}).get('v')
        item = clean(dict({k: v for k, v in stored.items() if k != 'logo'}, pk='WSET', sk='business', updated_at=now(), updated_by=who))
        return [put(item)], [None], {'logo': None, 'was': old}
    result = command(key, 'remove-logo', who, body or {}, build)
    photos.logo_drop(result.get('was'))
    return {'logo': None}


def logo_image():
    logo = business().get('logo') or {}
    raw = photos.logo_bytes(logo.get('v'))
    if raw is None:
        raise missing('No logo')
    return {'data': base64.b64encode(raw).decode(), **logo}


def save_business(key, who, body):
    def build():
        b = body or {}
        rate = num(b.get('tax_rate') or 0, 'Tax rate')
        if rate < 0 or rate > 50 or rate.as_tuple().exponent < -2:
            raise bad('Tax rate must be between 0 and 50 (at most 2 decimals)')
        limit = num(b.get('mechanic_discount_pct', 10) if b.get('mechanic_discount_pct') not in (None, '') else 10, 'Mechanic discount limit')
        if limit < 0 or limit > 100 or limit.as_tuple().exponent < -2:
            raise bad('The mechanic discount limit must be between 0 and 100 percent')
        terms = num(b.get('payment_terms_days') if b.get('payment_terms_days') not in (None, '') else 0, 'Payment terms')
        if terms < 0 or terms > 90 or terms != terms.to_integral_value():
            raise bad('Payment terms must be a whole number of days between 0 and 90')
        stored = get('WSET', 'business') or {}
        item = {'pk': 'WSET', 'sk': 'business', 'logo': stored.get('logo'), **shop_lists(b), 'payment_terms_days': int(terms), 'warranty': lines_text(b.get('warranty'), 'Warranty note', 200), 'qr_url': text(b.get('qr_url'), 'QR link', 200), 'qr_bits': qr_bits(b.get('qr_url'), b.get('qr_bits')), 'name': text(b.get('name'), 'Business name', 60, True),
                'address': lines_text(b.get('address'), 'Address', 200), 'phone': text(b.get('phone'), 'Phone', 60),
                'email': text(b.get('email'), 'Email', 80), 'reg_no': text(b.get('reg_no'), 'Registration / tax number', 60),
                'bank': lines_text(b.get('bank'), 'Bank details', 300), 'footer': lines_text(b.get('footer'), 'Footer', 300),
                'tax_name': text(b.get('tax_name') or 'VAT', 'Tax name', 12, True), 'tax_rate': rate, 'mechanic_discount_pct': limit, 'updated_at': now(), 'updated_by': who}
        return [put(clean(item))], [None], public(item)
    return command(key, 'save-business', who, body, build)


# ---------- vehicles ----------
FROM_JOBS = ('owner', 'phone', 'make', 'chassis')
INVOICE_TYPES = ('CASH', 'CREDIT', 'INSURANCE', 'WARRANTY')


def invoice_type(value, default='CASH'):
    v = str(value or default).strip().upper()
    if v not in INVOICE_TYPES:
        raise bad('Choose the invoice type: cash, credit, insurance or warranty')
    return v


def chassis_no(value):
    return text(value, 'Chassis number', 30).upper().replace(' ', '')


def next_job_no():
    """The next paper job card number (JOB-0001...). The counter row changes in the same transaction as the job, and only if nobody
    took that number first, so two people saving at once never get the same number (the loser is retried by command())."""
    seq = get('WSET', 'jobseq')
    n = int(seq['n']) + 1 if seq else 1
    row = {'pk': 'WSET', 'sk': 'jobseq', 'n': n, 'updated_at': now()}
    op = put(row, ConditionExpression='n = :o', ExpressionAttributeValues={':o': seq['n']}) if seq else put(row, ConditionExpression='attribute_not_exists(pk)')
    return 'JOB-%04d' % n, op


def vehicle_put(key, fields, always=(), fill_only=()):
    """Create or update the vehicle file. Empty values keep what is stored, except those in `always`.
    Fields in `fill_only` are written only while the vehicle file has no value for them: a job never changes who owns the vehicle
    (Edit details and New owner do), so a different name typed on a job cannot silently replace the owner."""
    current = get('VEHICLE', key)
    item = dict(current) if current else {'pk': 'VEHICLE', 'sk': key, 'id': key, 'created_at': now(), 'revision': 0}
    fields = {k: v for k, v in fields.items() if not (k in fill_only and item.get(k))}
    item.update({k: v for k, v in fields.items() if v not in (None, '')})
    for k in always:
        if fields.get(k) in (None, ''):
            item.pop(k, None)
    item['updated_at'] = now()
    item['revision'] = int(item['revision']) + 1
    if current:
        return put(item, ConditionExpression='revision = :r', ExpressionAttributeValues={':r': current['revision']})
    return put(item, ConditionExpression='attribute_not_exists(pk)')


def job_fill_only(current):
    """A job edit may correct the owner, number or make the vehicle file still holds from this very job (a typo fixed on the job page).
    Where the vehicle file holds something else (the vehicle changed hands), the job keeps its own value and the file is left alone."""
    v = get('VEHICLE', current['vehicle_key']) or {}
    return tuple(name for name, job_field in (('owner', 'customer'), ('phone', 'phone'), ('make', 'vehicle'), ('chassis', 'chassis'))
                 if v.get(name) and v.get(name) != current.get(job_field))


def history_put(j, rate=ZERO):
    t = totals(j, rate)
    return put(clean({'pk': 'VJOB#' + j['vehicle_key'], 'sk': j['created_at'] + '#' + j['id'], 'id': j['id'],
                      'created_at': j['created_at'], 'summary': j['summary'], 'status': j['status'], 'job_no': j.get('job_no'), 'invoice_type': j.get('invoice_type'), 'odometer': j.get('odometer'), 'customer': j.get('customer'), 'warranty_job': j.get('warranty_job') or None,
                      'total': t['total'], 'invoice_number': j.get('invoice_number'), 'invoice_id': j.get('invoice_id')}))


def vehicle_fields(j):
    return {'registration': j['registration'], 'owner': j['customer'], 'phone': j['phone'], 'make': j['vehicle'],
            'last_km': j.get('odometer'), 'chassis': j.get('chassis')}


def vehicles(search=''):
    needle = search.strip().lower()
    items = [public(v) for v in query('VEHICLE')]
    latest = {}
    held = {r['sk']: r.get('before', []) for r in query('WJPH')}
    for j in sorted(query('WJOB'), key=lambda j: j['created_at'], reverse=True):
        if j['status'] != 'ARCHIVED' and held.get(j['id']) and j['vehicle_key'] not in latest:
            latest[j['vehicle_key']] = held[j['id']][0]
    for v in items:
        if not v.get('front_photo') and latest.get(regkey(v['registration'])):
            v['front_photo'] = latest[regkey(v['registration'])]
    items = [v for v in items if not needle or needle in (v['registration'] + ' ' + v.get('owner', '') + ' ' + v.get('phone', '') + ' ' + v.get('make', '')).lower()]
    return sorted(items, key=lambda v: v['updated_at'], reverse=True)[:200]


def vehicle(key):
    """The vehicle file: details, every repair with its lines (kept current by every job save) and totals."""
    key = regkey(key)
    v = get('VEHICLE', key)
    if not v:
        raise missing('Vehicle not found')
    history = sorted((h for h in query('VJOB#' + key) if h['status'] != 'ARCHIVED'), key=lambda h: h['sk'], reverse=True)
    stored = {j['id']: j for j in batch_get([('WJOB', h['id']) for h in history[:40]])}
    bills = {i['id']: i for i in batch_get([('WINV', h['invoice_id']) for h in history[:40] if h.get('invoice_id')])}
    visits, spent, dates = [], ZERO, []
    for h in history:
        row = public(h)
        j = stored.get(h['id'])
        inv = bills.get(h.get('invoice_id'))
        if inv and inv['status'] != 'VOID':
            # what the customer actually owes now: a returned part lowers the bill, a part payment shows as PARTIAL
            row.update(total=inv['total'], paid=inv['paid'], balance=ZERO if inv['status'] == 'REFUNDED' else inv['total'] - inv['paid'], pay_status=inv['status'])
            h = dict(h, total=inv['total'])
        if j:
            row['parts'] = [{'name': p['name'], 'quantity': p['quantity'], 'unit_price': p['unit_price']} for p in j['parts']]
            row['labour'] = [{'description': l['description'], 'amount': l['amount']} for l in j['labour']]
            row['mechanic'] = j.get('mechanic', '')
            row['customer'] = j.get('customer', row.get('customer', ''))
        if h['status'] == 'INVOICED':
            spent += h['total']
            dates.append(local_date(h['created_at']))
        visits.append(row)
    gaps = [(a - b).days for a, b in zip(dates, dates[1:])]
    return {**public(v), 'history': visits, 'visits': len(dates), 'spent': spent, 'first_visit': min(dates).isoformat() if dates else None,
            'average_gap_days': round(sum(gaps) / len(gaps)) if gaps else None}


def edit_vehicle(key, idem, who, body):
    key = regkey(key)

    def build():
        b = body or {}
        if not get('VEHICLE', key):
            raise missing('Vehicle not found')
        fields = {}
        for name, label, size in (('owner', 'Owner', 100), ('make', 'Make and model', 100), ('notes', 'Notes', 1000)):
            if name in b:
                fields[name] = text(b[name], label, size, name == 'owner')
        if 'phone' in b:
            fields['phone'] = phone(b['phone'])
        if b.get('chassis'):
            fields['chassis'] = chassis_no(b['chassis'])
        if not fields:
            raise bad('Nothing to change')
        ops, events = open_jobs_follow(key, fields, [vehicle_put(key, fields)], [CHANGED])
        return ops, events, {'saved': True}
    return command(idem, 'edit-vehicle:' + key, who, body, build)


def open_jobs_follow(key, fields, ops, events):
    """Jobs that are still open follow the vehicle file, so a corrected phone number is not undone by the next save of the job.
    Billed jobs and issued invoices keep what was printed on them."""
    mapping = (('owner', 'customer'), ('phone', 'phone'), ('make', 'vehicle'))
    for j in [j for j in query('WJOB') if j.get('vehicle_key') == key and j['status'] == 'OPEN'][:10]:
        changes = {job_field: fields.get(name, '') for name, job_field in mapping if name in fields}
        if not changes:
            break
        new = dict(j, **changes, revision=int(j['revision']) + 1, updated_at=now())
        ops.append(put(clean(new), ConditionExpression='revision = :r and #s = :open', ExpressionAttributeNames={'#s': 'status'},
                       ExpressionAttributeValues={':r': j['revision'], ':open': 'OPEN'}))
        events.append(CHANGED)
    return ops, events


def new_owner(key, idem, who, body):
    """The vehicle changed hands. The old owner is kept in the vehicle's owner log; old jobs and bills keep the old owner's name."""
    key = regkey(key)

    def build():
        b = body or {}
        current = get('VEHICLE', key)
        if not current:
            raise missing('Vehicle not found')
        owner = text(b.get('owner'), 'New owner', 100, True)
        new_phone = phone(b.get('phone')) if b.get('phone') else ''
        if owner == current.get('owner') and new_phone == (current.get('phone') or ''):
            raise bad('That is already the owner on file. Use Edit details to correct a name or number.')
        log = list(current.get('owner_log') or [])[-19:] + [clean({'at': now(), 'from_owner': current.get('owner', ''), 'from_phone': current.get('phone', ''),
                                                                    'to_owner': owner, 'to_phone': new_phone, 'by': who})]
        fields = {'owner': owner, 'phone': new_phone, 'owner_log': log}
        ops, events = open_jobs_follow(key, fields, [vehicle_put(key, fields, always=('phone',))], [CHANGED])
        return ops, events, {'saved': True}
    return command(idem, 'vehicle-new-owner:' + key, who, body, build)


def owing(reg='', phone_number=''):
    """Unpaid and part-paid bills for this vehicle or this phone number, so a returning customer who still owes is noticed
    before a new job is opened. Matching the phone catches the same person bringing another vehicle."""
    key = re.sub(r'[^A-Z0-9]', '', str(reg or '').upper())
    key = key if 2 <= len(key) <= 12 else ''
    digits = ''.join(c for c in (phone_number or '') if c.isdigit())[-9:]
    out = []
    for i in query('WINV'):
        if i['status'] not in ('UNPAID', 'PARTIAL'):
            continue
        same_phone = len(digits) >= 7 and ''.join(c for c in (i.get('phone') or '') if c.isdigit())[-9:] == digits
        if (key and i.get('vehicle_key') == key) or same_phone:
            out.append({'id': i['id'], 'invoice_number': i['invoice_number'], 'registration': i['registration'], 'customer': i.get('customer', ''),
                        'total': i['total'], 'paid': i['paid'], 'balance': i['total'] - i['paid'], 'status': i['status'],
                        'created_at': i['created_at'], 'age_days': age_days(i['created_at'])})
    return sorted(out, key=lambda r: r['created_at'])[:20]


def service_due():
    limit, out = today() + timedelta(days=14), []
    for v in query('VEHICLE'):
        reason, when = None, v.get('next_service_date')
        if when and date.fromisoformat(when) <= limit:
            reason = 'overdue' if date.fromisoformat(when) < today() else 'soon'
        elif v.get('next_service_km') and v.get('last_km') and v['last_km'] >= v['next_service_km'] - 300:
            reason = 'km'
        if reason:
            out.append({**public(v), 'reason': reason})
    return sorted(out, key=lambda v: (v.get('next_service_date') or '9999', v['registration']))


# ---------- jobs ----------
def job(job_id):
    item = get('WJOB', job_id)
    if not item:
        raise missing('Repair job not found')
    return item


def view(j, rate=ZERO):
    return {**public(j), **totals(j, rate)}


def jobs():
    rate = business()['tax_rate']
    asked = {r['sk'] for r in query('WREQ') if r['status'] == 'PENDING'}
    faces = {v['sk']: v['front_photo'] for v in query('VEHICLE') if v.get('front_photo')}
    held = {r['sk']: r.get('before', []) for r in query('WJPH')}
    shots = {k: len(v) for k, v in held.items()}
    out = []
    for j in sorted(query('WJOB'), key=lambda j: j['created_at'], reverse=True):
        if j['status'] == 'ARCHIVED':
            continue
        v = view(j, rate)
        v['delete_requested'] = j['id'] in asked
        if j['vehicle_key'] in faces:
            v['front_photo'] = faces[j['vehicle_key']]
        elif held.get(j['id']):
            v['front_photo'] = held[j['id']][0]
        if shots.get(j['id']):
            v['photo_count'] = shots[j['id']]
        v['lines'] = len(v.pop('parts')) + len(v.pop('labour'))
        out.append(v)
    return out


def get_job(job_id, who='', owner=False):
    current = job(job_id)
    out = view(current, business()['tax_rate'])
    left = UNDO_SECONDS - (datetime.now(COLOMBO) - datetime.fromisoformat(current['created_at'])).total_seconds()
    out['undo_seconds_left'] = int(left) if current['status'] == 'OPEN' and left > 0 and (owner or current.get('created_by') == who) else 0
    req = get('WREQ', job_id)
    if req:
        out['delete_request'] = public(req)
    car = get('VEHICLE', current['vehicle_key']) or {}
    out.update({k: car[k] for k in ('front_photo', 'plate_photo') if car.get(k)})
    out['before_photos'] = (get('WJPH', job_id) or {}).get('before', [])
    return out


def create_job(key, who, body):
    def build():
        b = body or {}
        reg = text(b.get('registration'), 'Vehicle number', 20, True).upper()
        created, job_id = now(), str(uuid.uuid4())
        job_no, counter = next_job_no()
        j = clean({'pk': 'WJOB', 'sk': job_id, 'id': job_id, 'job_no': job_no, 'registration': reg, 'vehicle_key': regkey(reg),
                   'chassis': chassis_no(b.get('chassis')) if b.get('chassis') else '', 'invoice_type': invoice_type(b.get('invoice_type')),
                   'customer': text(b.get('customer'), 'Customer name', 100, True), 'phone': phone(b.get('phone')),
                   'address': lines_text(b.get('address'), 'Customer address', 200),
                   'vehicle': text(b.get('vehicle'), 'Vehicle make and model', 100),
                   'odometer': km(b.get('odometer'), 'Odometer'), 'summary': text(b.get('summary'), 'Complaint', 1000),
                   'mechanic': text(b.get('mechanic'), 'Mechanic', 60), 'notes': '', 'status': 'OPEN', 'revision': 0, 'stage': 'WAITING',
                   'brought_by': text(b.get('brought_by'), 'Brought in by', 100), 'brought_phone': phone(b.get('brought_phone')),
                   'parts': [], 'labour': [], 'discount': ZERO, 'created_by': who, 'created_at': created, 'updated_at': created})
        face = {'front_photo': photos.one(b.get('front_photo'), 'Front photo'), 'plate_photo': photos.one(b.get('plate_photo'), 'Plate photo')}
        before = photos.many(b.get('before_photos'), 'Condition photos')
        ops = [put(j), vehicle_put(j['vehicle_key'], {**vehicle_fields(j), **face}, fill_only=FROM_JOBS), history_put(j), counter]
        if before:
            ops.append(put({'pk': 'WJPH', 'sk': job_id, 'before': before, 'n': 1, 'updated_at': created}))
        return ops, [None] * len(ops), view(j)
    return command(key, 'create-job', who, body, build)


def job_photos(job_id, key, who, body):
    """Photos on an OPEN job: condition photos before fixing (add/remove) and the vehicle's front and plate photos.
    They live apart from the job lines, so adding one never clashes with someone editing the bill."""
    def build():
        b = body or {}
        current = job(job_id)
        if current['status'] != 'OPEN':
            raise conflict('This job already has an invoice')
        held = get('WJPH', job_id)
        before = list((held or {}).get('before', []))
        before = [p for p in before if p not in photos.many(b.get('remove'), 'Photos')]
        for pid in photos.many(b.get('add'), 'Photos'):
            if pid not in before:
                before.append(pid)
        if len(before) > 6:
            raise bad('Up to 6 condition photos')
        n = int((held or {}).get('n', 0)) + 1
        row = {'pk': 'WJPH', 'sk': job_id, 'before': before, 'n': n, 'updated_at': now()}
        ops = [put(row, ConditionExpression='n = :n', ExpressionAttributeValues={':n': held['n']}) if held else put(row, ConditionExpression='attribute_not_exists(pk)'),
               check('WJOB', job_id, '#s = :open', {':open': 'OPEN'}, {'#s': 'status'})]
        labels = [None, 'This job already has an invoice']
        face = {k: photos.one(b[k], k) for k in ('front_photo', 'plate_photo') if k in b}
        if any(face.values()):
            ops.append(vehicle_put(current['vehicle_key'], face))
            labels.append(None)
        return ops, labels, {'before_photos': before, **{k: v for k, v in face.items() if v}}
    return command(key, 'job-photos:' + job_id, who, body, build)


def save_job(job_id, key, who, body, owner=True):
    """Save details and lines of an OPEN job. The body carries the revision it was loaded at."""
    def build():
        current, b = job(job_id), body or {}
        if current['status'] != 'OPEN':
            raise conflict('This job already has an invoice')
        if num(b.get('revision'), 'Revision') != current['revision']:
            raise conflict(CHANGED)
        j = dict(current)
        for field, label, size in (('customer', 'Customer name', 100), ('vehicle', 'Vehicle make and model', 100),
                                   ('summary', 'Complaint', 1000), ('mechanic', 'Mechanic', 60), ('notes', 'Notes', 1000)):
            if field in b:
                j[field] = text(b[field], label, size, field == 'customer')
        if 'address' in b:
            j['address'] = lines_text(b['address'], 'Customer address', 200)
        if 'phone' in b:
            j['phone'] = phone(b['phone'])
        if 'odometer' in b:
            j['odometer'] = km(b['odometer'], 'Odometer')
        if 'chassis' in b:
            j['chassis'] = chassis_no(b['chassis']) if b['chassis'] else ''
        if 'invoice_type' in b:
            j['invoice_type'] = invoice_type(b['invoice_type'])
        if 'parts' in b:
            j['parts'] = parts_in(b['parts'])
            if stock_quantities(j['parts']) != stock_quantities(current.get('parts', [])):
                raise bad('Parts taken from stock change only with Pick from stock or Take back, so the stock stays right')
        if 'labour' in b:
            j['labour'] = labour_in(b['labour'])
        if 'discount' in b:
            j['discount'] = money(b['discount'] or 0, 'Discount')
        if 'next_service_date' in b:
            j['next_service_date'] = day(b['next_service_date'], 'Next service date')
        if 'next_service_km' in b:
            j['next_service_km'] = km(b['next_service_km'], 'Next service km')
        for field, label in (('brought_by', 'Brought in by'),):
            if field in b:
                j[field] = text(b[field], label, 100)
        if 'brought_phone' in b:
            j['brought_phone'] = phone(b['brought_phone'])
        if 'warranty_until' in b:
            j['warranty_until'] = day(b['warranty_until'], 'Warranty until')
        if 'warranty_km' in b:
            j['warranty_km'] = km(b['warranty_km'], 'Warranty km')
        if 'warranty_job' in b:
            j['warranty_job'] = bool(b['warranty_job'])
        if totals(j)['subtotal'] < 0:
            raise bad('The discount is more than the bill')
        if not owner and discount_given(j) != discount_given(current):
            pct = business()['mechanic_discount_pct']
            base = sum((line_gross(p).quantize(MONEY, ROUND_HALF_UP) for p in j['parts']), ZERO) + totals(j)['labour_total']
            if discount_given(j) > (base * pct / HUNDRED).quantize(MONEY, ROUND_HALF_UP):
                raise bad('A discount above %s%% needs the owner. Ask the owner to apply it.' % pct.normalize())
        j['revision'], j['updated_at'] = int(current['revision']) + 1, now()
        j = clean(j)
        rate = business()['tax_rate']
        op = put(j, ConditionExpression='revision = :r and #s = :open', ExpressionAttributeNames={'#s': 'status'},
                 ExpressionAttributeValues={':r': current['revision'], ':open': 'OPEN'})
        return [op, vehicle_put(j['vehicle_key'], vehicle_fields(j), fill_only=job_fill_only(current)), history_put(j, rate)], [CHANGED, None, None], view(j, rate)
    return command(key, 'save-job:' + job_id, who, body, build)


STAGES = ('WAITING', 'IN_PROGRESS', 'PARTS', 'READY')


def set_stage(job_id, key, who, body):
    """Where an open job is in the workshop. It changes one field only and not the revision, so ticking it never makes
    someone else's open job page say 'changed'."""
    def build():
        current, stage = job(job_id), str((body or {}).get('stage') or '')
        if current['status'] != 'OPEN':
            raise conflict('Only an open job has a stage')
        if stage not in STAGES:
            raise bad('Choose where the job is')
        op = update('WJOB', job_id, 'SET stage = :s, stage_at = :a, stage_by = :w',
                    {':s': stage, ':a': now(), ':w': who, ':open': 'OPEN'}, names={'#st': 'status'}, condition='#st = :open')
        return [op], [CHANGED], view(dict(current, stage=stage, stage_at=now()), business()['tax_rate'])
    return command(key, 'job-stage:' + job_id, who, body, build)


def line_name(product):
    """A stock part's name as a bill line (the PDFs are English only, so fall back to the part number)."""
    name = ' '.join(str(product['name']).split())
    return name[:100] if LATIN.fullmatch(name) else (product.get('part_number') or product['sku'])[:100]


def use_stock(job_id, key, who, body):
    """Take a part from stock onto an open job (op 'use'), or put some back (op 'return'). The job line, the revision and the
    stock move in one transaction; the price is the part's selling price at that moment. No revision is needed: the request is
    additive, so a retry with the same key is safe and a concurrent edit only makes it run again."""
    def build():
        current, b = job(job_id), body or {}
        if current['status'] != 'OPEN':
            raise conflict('This job already has an invoice')
        op, qty = b.get('op'), quantity(b.get('quantity', 1))
        if op not in ('use', 'return'):
            raise bad('Choose use or return')
        product = inventory.load_product(b.get('productId'))
        parts = [dict(p) for p in current.get('parts', [])]
        line = next((p for p in parts if p.get('product_id') == product['id']), None)
        if op == 'use':
            if line is None and len(stock_quantities(parts)) >= MAX_STOCK_LINES:
                raise bad('At most %d stock parts on one job' % MAX_STOCK_LINES)
            if line is None and len(parts) >= 60:
                raise bad('Too many part lines on this job')
            stock_ops, balance = inventory.job_stock_ops(product, 'ISSUE', qty, job_id, who, 'Used on ' + current['registration'])
            if line:
                line['quantity'] += qty
            else:
                parts.append({'name': line_name(product), 'quantity': qty, 'unit_price': product['selling_price'], 'product_id': product['id']})
        else:
            if not line:
                raise conflict('This part was not taken from stock for this job')
            if qty > line['quantity']:
                raise conflict('Only %s of this part are on the job' % line['quantity'].normalize())
            stock_ops, balance = inventory.job_stock_ops(product, 'RETURN', qty, job_id, who, 'Taken back from ' + current['registration'], line['unit_price'])
            line['quantity'] -= qty
            if line['quantity'] == 0:
                parts.remove(line)
        j = dict(current, parts=parts, revision=int(current['revision']) + 1, updated_at=now())
        if totals(j)['subtotal'] < 0:
            raise conflict('The discount is more than the bill. Lower the discount first')
        j = clean(j)
        rate = business()['tax_rate']
        job_op = put(j, ConditionExpression='revision = :r and #s = :open', ExpressionAttributeNames={'#s': 'status'},
                     ExpressionAttributeValues={':r': current['revision'], ':open': 'OPEN'})
        ops = [job_op, vehicle_put(j['vehicle_key'], vehicle_fields(j), fill_only=FROM_JOBS), history_put(j, rate)] + stock_ops
        # adding or returning a part never overwrites anyone's edit, so a concurrent save just makes this run again on the fresh job
        return ops, [None] * len(ops), {**view(j, rate), 'stock': {'product_id': product['id'], 'balance': balance}}
    return command(key, 'use-stock:' + job_id, who, body, build)


def release_stock(current, who, why):
    """When an open job is cancelled or deleted: every stock part goes back. The lines stay on the job as plain text,
    so the history still shows what was planned and a restored job is an ordinary one."""
    ops, parts = [], []
    for p in current.get('parts', []):
        pid = p.get('product_id')
        if not pid:
            parts.append(p)
            continue
        product = inventory.load_product(pid)
        stock_ops, _ = inventory.job_stock_ops(product, 'RETURN', p['quantity'], current['id'], who, why, p['unit_price'])
        ops += stock_ops
        parts.append({k: v for k, v in p.items() if k != 'product_id'})
    return ops, parts


def cancel_job(job_id, key, who, body):
    def build():
        current = job(job_id)
        if current['status'] != 'OPEN':
            raise conflict('Only an open job can be cancelled')
        back, parts = release_stock(current, who, 'Job cancelled')
        j = dict(current, parts=parts, status='CANCELLED', revision=int(current['revision']) + 1, updated_at=now())
        op = put(j, ConditionExpression='revision = :r and #s = :open', ExpressionAttributeNames={'#s': 'status'},
                 ExpressionAttributeValues={':r': current['revision'], ':open': 'OPEN'})
        ops = [op, history_put(j), audit('CANCELLED', j, who, text((body or {}).get('reason'), 'Reason', 200))] + back
        return ops, [CHANGED] + [None] * (len(ops) - 1), view(j)
    return command(key, 'cancel-job:' + job_id, who, body, build)


# ---------- delete (archive), requests, undo, audit ----------
UNDO_SECONDS = 600


def audit(action, j, who, reason=''):
    """One line in the workshop log: who did what to which job, and why."""
    return put(clean({'pk': 'WAUDIT', 'sk': now() + '#' + uuid.uuid4().hex[:8], 'action': action, 'job_id': j['id'],
                      'registration': j['registration'], 'customer': j['customer'], 'actor': who, 'reason': reason}))


def _archive(current, who, reason, action):
    if current['status'] == 'ARCHIVED':
        raise conflict('This job is already deleted')
    if current['status'] == 'INVOICED':
        raise conflict('A job with an invoice cannot be deleted. Void the invoice first (only when nothing was paid)')
    back, parts = release_stock(current, who, 'Job deleted')
    j = clean(dict(current, parts=parts, status='ARCHIVED', prior_status=current['status'], archived_by=who, archived_at=now(),
                   archive_reason=reason, revision=int(current['revision']) + 1, updated_at=now()))
    op = put(j, ConditionExpression='revision = :r and #s <> :done', ExpressionAttributeNames={'#s': 'status'},
             ExpressionAttributeValues={':r': current['revision'], ':done': 'INVOICED'})
    ops = [op, history_put(j), audit(action, j, who, reason), delete('WREQ', j['id'])] + back
    return ops, [CHANGED] + [None] * (len(ops) - 1), view(j)


def archive_job(job_id, key, who, body):
    """Owner only. Delete moves the job to the Archive: hidden everywhere, kept for the log, and it can be restored."""
    def build():
        return _archive(job(job_id), who, text((body or {}).get('reason'), 'Reason', 200, True), 'ARCHIVED')
    return command(key, 'archive-job:' + job_id, who, body, build)


def undo_job(job_id, key, who, body, owner=False):
    """For a job opened by mistake: whoever opened it can take it back for ten minutes, if it is still open."""
    def build():
        current = job(job_id)
        if current['status'] != 'OPEN':
            raise conflict('Only an open job can be undone')
        if not owner and current.get('created_by') != who:
            raise conflict('Only the person who opened the job can undo it')
        if (datetime.now(COLOMBO) - datetime.fromisoformat(current['created_at'])).total_seconds() > UNDO_SECONDS:
            raise conflict('The 10 minutes to undo this job are over. Use Request delete instead')
        return _archive(current, who, 'Opened by mistake, undone by ' + who, 'UNDONE')
    return command(key, 'undo-job:' + job_id, who, body, build)


def restore_job(job_id, key, who, body):
    def build():
        current = job(job_id)
        if current['status'] != 'ARCHIVED':
            raise conflict('This job is not in the archive')
        j = clean({k: v for k, v in current.items() if k not in ('archived_by', 'archived_at', 'archive_reason', 'prior_status')})
        j.update(status=current.get('prior_status') or 'OPEN', revision=int(current['revision']) + 1, updated_at=now())
        op = put(j, ConditionExpression='revision = :r and #s = :a', ExpressionAttributeNames={'#s': 'status'},
                 ExpressionAttributeValues={':r': current['revision'], ':a': 'ARCHIVED'})
        return [op, history_put(j), audit('RESTORED', j, who)], [CHANGED, None, None], view(j)
    return command(key, 'restore-job:' + job_id, who, body, build)


def request_delete(job_id, key, who, body):
    """A mechanic asks the owner to delete an open job. The owner approves (archive) or rejects with a note."""
    def build():
        current = job(job_id)
        if current['status'] != 'OPEN':
            raise conflict('Only an open job can be sent for deletion')
        asked = get('WREQ', job_id)
        if asked and asked['status'] == 'PENDING':
            raise conflict('A delete request is already waiting for the owner')
        req = clean({'pk': 'WREQ', 'sk': job_id, 'job_id': job_id, 'registration': current['registration'], 'customer': current['customer'],
                     'reason': text((body or {}).get('reason'), 'Reason', 200, True), 'requested_by': who, 'requested_at': now(), 'status': 'PENDING'})
        return [put(req), audit('DELETE_REQUESTED', current, who, req['reason'])], [None, None], public(req)
    return command(key, 'request-delete:' + job_id, who, body, build)


def reject_delete(job_id, key, who, body):
    def build():
        asked = get('WREQ', job_id)
        if not asked or asked['status'] != 'PENDING':
            raise conflict('There is no waiting delete request for this job')
        note = text((body or {}).get('note'), 'Note', 200)
        req = clean(dict(asked, status='REJECTED', decided_by=who, decided_at=now(), note=note))
        return [put(req), audit('REQUEST_REJECTED', job(job_id), who, note)], [None, None], public(req)
    return command(key, 'reject-delete:' + job_id, who, body, build)


def archive():
    """The Archive tab: deleted jobs, and the log of who did what."""
    rate = business()['tax_rate']
    deleted = []
    for j in sorted((j for j in query('WJOB') if j['status'] == 'ARCHIVED'), key=lambda j: j['archived_at'], reverse=True):
        v = view(j, rate)
        v['lines'] = len(v.pop('parts')) + len(v.pop('labour'))
        deleted.append(v)
    who = emails()
    log = [dict(public(a), actor_email=who.get(a.get('actor'))) for a in sorted(query('WAUDIT'), key=lambda a: a['sk'], reverse=True)[:150]]
    return {'jobs': deleted, 'log': log}


# ---------- invoices ----------
def invoice_status(total, paid, payments=()):
    """PAID, PARTIAL or UNPAID. A bill whose money all went back to the customer is REFUNDED, not 'unpaid': nothing is chased for it
    (void it to correct the job, or take a new payment and it becomes part paid or paid again)."""
    if paid >= total:
        return 'PAID'
    if paid > 0:
        return 'PARTIAL'
    return 'REFUNDED' if any(p.get('refund') for p in payments) else 'UNPAID'


def terms_days(shop=None):
    """Days a customer has to pay: the Setup payment terms, or 7 days when none is set."""
    return int((shop or business()).get('payment_terms_days') or 0) or 7


def finalise(job_id, key, who, body):
    """Create the invoice from the job's saved lines; the job becomes INVOICED."""
    def build():
        current = job(job_id)
        if current['status'] != 'OPEN':
            raise conflict('This job already has an invoice or is cancelled')
        if num((body or {}).get('revision'), 'Revision') != current['revision']:
            raise conflict(CHANGED)
        if not current['parts'] and not current['labour']:
            raise bad('Add at least one part or labour line first')
        shop = business()
        rate = shop['tax_rate']
        stamped = dict(current, tax_rate=rate)
        t, created, invoice_id = totals(stamped), now(), str(uuid.uuid4())
        number = shop['invoice_prefix'] + '-' + datetime.now(COLOMBO).strftime('%Y%m%d') + '-' + invoice_id[:6].upper()
        keep = ('registration', 'vehicle_key', 'customer', 'address', 'phone', 'vehicle', 'odometer', 'summary', 'mechanic', 'parts', 'labour',
                'next_service_date', 'next_service_km', 'brought_by', 'brought_phone', 'warranty_until', 'warranty_km', 'warranty_job',
                'job_no', 'chassis', 'invoice_type')
        invoice = clean({'pk': 'WINV', 'sk': invoice_id, 'id': invoice_id, 'invoice_number': number, 'job_id': job_id,
                         **{k: current.get(k) for k in keep}, **t, 'tax_name': shop['tax_name'], 'tax_rate': rate, 'currency': 'LKR',
                         'paid': ZERO, 'payments': [], 'status': invoice_status(t['total'], ZERO), 'revision': 0, 'approved_by': who,
                         'created_at': created, 'business': {k: v for k, v in shop.items() if k in DEFAULT_BUSINESS and k not in ('mechanic_discount_pct', 'labour_items', 'mechanics', 'default_reorder_level')}})
        j = clean(dict(stamped, status='INVOICED', invoice_id=invoice_id, invoice_number=number,
                       revision=int(current['revision']) + 1, updated_at=created, out_at=created))
        op = put(j, ConditionExpression='revision = :r and #s = :open', ExpressionAttributeNames={'#s': 'status'},
                 ExpressionAttributeValues={':r': current['revision'], ':open': 'OPEN'})
        fields = {**vehicle_fields(j), 'next_service_date': j.get('next_service_date'), 'next_service_km': j.get('next_service_km')}
        ops = [op, put(invoice), vehicle_put(j['vehicle_key'], fields, always=('next_service_date', 'next_service_km'), fill_only=FROM_JOBS), history_put(j)]
        return ops, [CHANGED, None, None, None], public(invoice)
    return command(key, 'finalise:' + job_id, who, body, build)


def invoice(invoice_id):
    item = get('WINV', invoice_id)
    if not item:
        raise missing('Invoice not found')
    return item


def invoices():
    out = []
    for i in sorted(query('WINV'), key=lambda i: i['created_at'], reverse=True):
        v = public(i)
        v.pop('parts'), v.pop('labour'), v.pop('business', None)
        out.append(v)
    return out


def get_invoice(invoice_id):
    i = public(invoice(invoice_id))
    i['parts'] = [{**p, 'amount': line_total(p)} for p in i['parts']]
    return i


def pay(invoice_id, key, who, body):
    def build():
        current, b = invoice(invoice_id), body or {}
        if current['status'] == 'VOID':
            raise conflict('This invoice was voided')
        amount, method = money(b.get('amount'), 'Amount'), str(b.get('method') or 'CASH').upper()
        if amount <= 0 or method not in METHODS:
            raise bad('Enter an amount and pick how it was paid')
        balance = current['total'] - current['paid']
        if amount > balance:
            raise conflict('That is more than the balance of LKR ' + format(balance, ',.2f'))
        if len(current['payments']) >= 100:
            raise conflict('Too many payments on this invoice')
        entry = {'id': str(uuid.uuid4())[:8], 'amount': amount, 'method': method, 'note': text(b.get('note'), 'Note', 200),
                 'at': now(), 'by': who}
        paid = current['paid'] + amount
        new = dict(current, payments=list(current['payments']) + [entry], paid=paid,
                   status=invoice_status(current['total'], paid, current['payments']), revision=int(current['revision']) + 1)
        op = put(new, ConditionExpression='revision = :r', ExpressionAttributeValues={':r': current['revision']})
        return [op], [CHANGED], public(new)
    return command(key, 'pay:' + invoice_id, who, body, build)


def refund(invoice_id, key, who, body):
    """Owner only. Money given back to the customer is a negative payment with the reason on it, so the bill, the reports and
    the audit trail all show it. After a full refund the invoice can be voided and the job corrected."""
    def build():
        current, b = invoice(invoice_id), body or {}
        if current['status'] == 'VOID':
            raise conflict('This invoice was voided')
        amount, method = money(b.get('amount'), 'Amount'), str(b.get('method') or 'CASH').upper()
        if amount <= 0 or method not in METHODS:
            raise bad('Enter the amount and how it was given back')
        if amount > current['paid']:
            raise conflict('That is more than was paid: LKR ' + format(current['paid'], ',.2f'))
        if len(current['payments']) >= 100:
            raise conflict('Too many payments on this invoice')
        reason = text(b.get('reason'), 'Reason', 180, True)
        entry = {'id': str(uuid.uuid4())[:8], 'amount': -amount, 'method': method, 'note': 'Refund: ' + reason, 'refund': True, 'at': now(), 'by': who}
        paid = current['paid'] - amount
        new = dict(current, payments=list(current['payments']) + [entry], paid=paid,
                   status=invoice_status(current['total'], paid, list(current['payments']) + [entry]), revision=int(current['revision']) + 1)
        op = put(new, ConditionExpression='revision = :r', ExpressionAttributeValues={':r': current['revision']})
        j = job(current['job_id'])
        return [op, audit('INVOICE_REFUND', j, who, current['invoice_number'] + ' LKR ' + format(amount, ',.2f') + ': ' + reason)], [CHANGED, None], public(new)
    return command(key, 'refund:' + invoice_id, who, body, build)


def void_invoice(invoice_id, key, who, body):
    """Owner only. A mistaken invoice with no payments is voided and its job reopens for correction."""
    def build():
        current = invoice(invoice_id)
        if current['status'] == 'VOID':
            raise conflict('This invoice is already voided')
        if current['paid'] > 0:
            raise conflict('This invoice has payments. Void is only for unpaid invoices')
        j = job(current['job_id'])
        new = dict(current, status='VOID', revision=int(current['revision']) + 1, voided_by=who, voided_at=now())
        reopened = clean({k: v for k, v in j.items() if k not in ('invoice_id', 'invoice_number', 'tax_rate')})
        reopened.update(status='OPEN', revision=int(j['revision']) + 1, updated_at=now())
        ops = [put(new, ConditionExpression='revision = :r', ExpressionAttributeValues={':r': current['revision']}),
               put(reopened, ConditionExpression='revision = :r and #s = :done', ExpressionAttributeNames={'#s': 'status'},
                   ExpressionAttributeValues={':r': j['revision'], ':done': 'INVOICED'}), history_put(reopened, business()['tax_rate']),
               audit('INVOICE_VOIDED', reopened, who, current['invoice_number'])]
        return ops, [CHANGED, CHANGED, None, None], public(new)
    return command(key, 'void:' + invoice_id, who, body, build)


def return_parts(invoice_id, key, who, body):
    """Owner only. The customer brings parts back after the invoice was issued. The parts go back into stock (one RETURN in the
    stock history per part, naming the invoice), the bill is reduced by their value plus tax, and if that leaves the customer
    overpaid the money given back is recorded as a refund. The invoice stays, with the credit written on it."""
    def build():
        current, b = invoice(invoice_id), body or {}
        if current['status'] == 'VOID':
            raise conflict('This invoice was voided')
        asked = b.get('lines')
        if not isinstance(asked, list) or not asked:
            raise bad('Pick the parts that came back')
        reason = text(b.get('reason'), 'Reason', 180, True)
        parts = [dict(p) for p in current['parts']]
        credit, per_product, credited = ZERO, {}, []
        seen = set()
        for row in asked:
            if not isinstance(row, dict):
                raise bad('Pick the parts that came back')
            try:
                index = int(row.get('index'))
            except (TypeError, ValueError):
                raise bad('Pick the parts that came back') from None
            if index in seen or not 0 <= index < len(parts):
                raise bad('Pick each part once')
            seen.add(index)
            part, qty = parts[index], quantity(row.get('quantity'))
            left = part['quantity'] - part.get('returned', ZERO)
            if qty > left:
                raise conflict('Only %s of %s can still be returned' % (left.normalize(), part['name']))
            amount = line_total(dict(part, quantity=qty))
            credit += amount
            part['returned'] = part.get('returned', ZERO) + qty
            credited.append({'name': part['name'], 'quantity': qty, 'amount': amount})
            if part.get('product_id'):
                e = per_product.setdefault(part['product_id'], [ZERO, part['unit_price']])
                e[0] += qty
        tax = (credit * current.get('tax_rate', ZERO) / HUNDRED).quantize(MONEY, ROUND_HALF_UP) if credit > 0 else ZERO
        credit += tax
        total = current['total'] - credit
        if total < 0:
            raise conflict('That credit is more than the invoice')
        over = max(current['paid'] - total, ZERO)
        payments, paid = list(current['payments']), current['paid']
        if over > 0:
            method = str(b.get('refundMethod') or '').upper()
            if method not in METHODS:
                raise bad('The customer has paid more than the new total. Choose how the money was given back')
            if len(payments) >= 100:
                raise conflict('Too many payments on this invoice')
            payments.append({'id': str(uuid.uuid4())[:8], 'amount': -over, 'method': method, 'note': 'Refund: returned parts, ' + reason,
                             'refund': True, 'at': now(), 'by': who})
            paid -= over
        entry = {'id': str(uuid.uuid4())[:8], 'at': now(), 'by': who, 'reason': reason, 'amount': credit, 'lines': credited}
        new = dict(current, parts=parts, payments=payments, paid=paid, total=total,
                   original_total=current.get('original_total', current['total']),
                   credit_total=current.get('credit_total', ZERO) + credit, credits=list(current.get('credits') or []) + [entry],
                   status=invoice_status(total, paid, payments), revision=int(current['revision']) + 1)
        ops = [put(new, ConditionExpression='revision = :r', ExpressionAttributeValues={':r': current['revision']})]
        j = job(current['job_id'])
        for pid, (qty, price) in per_product.items():
            stock_ops, _ = inventory.job_stock_ops(inventory.load_product(pid), 'RETURN', qty, current['job_id'], who,
                                                   'Returned after invoice ' + current['invoice_number'] + ': ' + reason, price)
            ops += stock_ops
        ops.append(audit('INVOICE_RETURN', j, who, current['invoice_number'] + ' LKR ' + format(credit, ',.2f') + ': ' + reason))
        return ops, [CHANGED] + [None] * (len(ops) - 1), public(new)
    result = command(key, 'return-parts:' + invoice_id, who, body, build)
    inventory._cache['until'] = 0
    return result


# ---------- suggestions: parts and labour the workshop already uses ----------
_cache = {'at': 0, 'value': None}


def suggestions():
    """Frequent part names and labour jobs with the latest price, so typing a line is two taps. Cached 5 minutes."""
    if _cache['value'] is not None and time.time() - _cache['at'] < 300:
        return _cache['value']
    parts, labour = {}, {}
    for i in sorted(query('WINV'), key=lambda i: i['created_at'], reverse=True):
        if i['status'] == 'VOID':
            continue
        for p in i['parts']:
            e = parts.setdefault(p['name'].lower(), {'name': p['name'], 'price': p['unit_price'], 'uses': 0})
            e['uses'] += 1
        for l in i['labour']:
            e = labour.setdefault(l['description'].lower(), {'description': l['description'], 'amount': l['amount'], 'uses': 0})
            e['uses'] += 1
    value = {'parts': sorted(parts.values(), key=lambda e: -e['uses'])[:150], 'labour': sorted(labour.values(), key=lambda e: -e['uses'])[:80]}
    _cache.update(at=time.time(), value=value)
    return value


# ---------- dashboard ----------
def age_days(iso):
    return (today() - local_date(iso)).days


def dashboard():
    rate = business()['tax_rate']
    now_day, month = today().isoformat(), today().replace(day=1).isoformat()
    open_jobs = [view(j, rate) for j in sorted(query('WJOB'), key=lambda j: j['created_at'], reverse=True) if j['status'] == 'OPEN']
    inv = [i for i in query('WINV') if i['status'] != 'VOID']
    unpaid = [i for i in inv if i['status'] in ('UNPAID', 'PARTIAL')]
    out = {'today': {'date': now_day, 'invoices': 0, 'billed': ZERO, 'received': ZERO}, 'month': {'from': month, 'invoices': 0, 'billed': ZERO, 'received': ZERO}}
    for i in inv:
        d = local_date(i['created_at']).isoformat()
        for key, since in (('today', now_day), ('month', month)):
            if d >= since:
                out[key]['invoices'] += 1
                out[key]['billed'] += i['total']
        for p in i['payments']:
            pd = local_date(p['at']).isoformat()
            for key, since in (('today', now_day), ('month', month)):
                if pd >= since:
                    out[key]['received'] += p['amount']
    for j in open_jobs:
        j['age_days'] = age_days(j['created_at'])
        j.pop('parts'), j.pop('labour')
    ready = [j for j in open_jobs if j.get('stage') == 'READY']
    return {**out, 'open_jobs': open_jobs[:12], 'open_count': len(open_jobs), 'ready_jobs': ready[:12], 'ready_count': len(ready), 'unpaid_count': len(unpaid),
            'unpaid_total': sum((i['total'] - i['paid'] for i in unpaid), ZERO),
            'overdue_count': sum(1 for i in unpaid if age_days(i['created_at']) > terms_days()), 'terms_days': terms_days(),
            'oldest_unpaid_days': max((age_days(i['created_at']) for i in unpaid), default=0), 'due_count': len(service_due()),
            'delete_requests': sorted((public(r) for r in query('WREQ') if r['status'] == 'PENDING'), key=lambda r: r['requested_at'])}


# ---------- reports (owner) ----------
def export_all():
    """Owner only: everything the workshop holds as one JSON file (photos and the logo are left out, they are large)."""
    return {'exported_at': now(), 'format': 'lifta-export-1',
            'settings': {k: v for k, v in business().items() if k != 'logo'},
            'jobs': [public(j) for j in query('WJOB')],
            'estimates': [public(q) for q in sorted(query('WQUO'), key=lambda q: q['created_at'])],
            'invoices': [public(i) for i in sorted(query('WINV'), key=lambda i: i['created_at'])],
            'vehicles': [public(v) for v in query('VEHICLE')],
            'workshop_log': [public(a) for a in query('WAUDIT')],
            'stock_parts': [public(p) for p in query('PRODUCT')],
            'stock_movements': [public(m) for m in query('MOVE')]}


def report(start='', end=''):
    first = today().replace(day=1)
    start, end = day(start, 'From') or first.isoformat(), day(end, 'Until') or today().isoformat()
    a, b = date.fromisoformat(start), date.fromisoformat(end)
    if b < a:
        raise bad('The end date is before the start date')
    if (b - a).days > 366:
        raise bad('Pick a range of one year or less')
    sums = {k: ZERO for k in ('parts_total', 'labour_total', 'discount', 'tax', 'total')}
    by_day = {(a + timedelta(days=n)).isoformat(): ZERO for n in range((b - a).days + 1)}
    by_mechanic, by_method, top_parts, top_labour, cars = {}, {}, {}, {}, set()
    count, period_unpaid, received = 0, ZERO, ZERO
    ageing, unpaid_list = {'d0_7': ZERO, 'd8_30': ZERO, 'd31_60': ZERO, 'd60_plus': ZERO}, []
    for i in query('WINV'):
        if i['status'] == 'VOID':
            continue
        balance = i['total'] - i['paid']
        if balance > 0 and i['status'] != 'REFUNDED':
            days = age_days(i['created_at'])
            ageing['d0_7' if days <= 7 else 'd8_30' if days <= 30 else 'd31_60' if days <= 60 else 'd60_plus'] += balance
            unpaid_list.append({'invoice_number': i['invoice_number'], 'registration': i['registration'], 'customer': i['customer'], 'days': days, 'balance': balance, 'id': i['id']})
        for p in i['payments']:
            if start <= local_date(p['at']).isoformat() <= end:
                received += p['amount']
                by_method[p['method']] = by_method.get(p['method'], ZERO) + p['amount']
        created = local_date(i['created_at']).isoformat()
        if not start <= created <= end:
            continue
        count += 1
        cars.add(i['vehicle_key'])
        period_unpaid += balance
        for k in sums:
            sums[k] += i.get(k, ZERO)
        by_day[created] += i['total']
        name = i.get('mechanic') or 'Not set'
        row = by_mechanic.setdefault(name.lower(), {'mechanic': name, 'jobs': 0, 'total': ZERO})
        row['jobs'] += 1
        row['total'] += i['total']
        for p in i['parts']:
            e = top_parts.setdefault(p['name'].lower(), {'name': p['name'], 'quantity': ZERO, 'amount': ZERO})
            e['quantity'] += p['quantity']
            e['amount'] += line_total(p)
        for l in i['labour']:
            e = top_labour.setdefault(l['description'].lower(), {'name': l['description'], 'times': 0, 'amount': ZERO})
            e['times'] += 1
            e['amount'] += l['amount']
    unpaid_list.sort(key=lambda x: -x['days'])
    return {'from': start, 'until': end, 'currency': 'LKR', 'invoices': count, 'vehicles': len(cars), **sums, 'received': received,
            'unpaid': period_unpaid, 'average': (sums['total'] / count).quantize(MONEY, ROUND_HALF_UP) if count else ZERO,
            'outstanding_all_time': sum(ageing.values(), ZERO), 'ageing': ageing,
            'by_day': [{'date': d, 'billed': v} for d, v in by_day.items()],
            'by_mechanic': sorted(by_mechanic.values(), key=lambda r: -r['total']),
            'by_method': sorted(({'method': k, 'amount': v} for k, v in by_method.items()), key=lambda r: -r['amount']),
            'top_parts': sorted(top_parts.values(), key=lambda r: -r['amount'])[:10],
            'top_labour': sorted(top_labour.values(), key=lambda r: -r['amount'])[:10], 'unpaid_list': unpaid_list[:20]}


# ---------- PDFs ----------
def pdf(invoice_id):
    i = get_invoice(invoice_id)
    i['date'] = local_date(i['created_at']).isoformat()
    i['payments'] = [{**p, 'date': local_date(p['at']).isoformat()} for p in i['payments']]
    i['business'] = {**i.get('business', {}), 'tax_rate': i['tax_rate']}
    terms = int(i['business'].get('payment_terms_days') or 0)
    i['terms'] = terms
    i['due_date'] = (local_date(i['created_at']) + timedelta(days=terms)).isoformat() if terms else ''
    i['tax_name'] = i.get('tax_name', 'VAT')
    return bills.invoice(i), i['invoice_number']


def vehicle_pdf(key):
    v = vehicle(key)
    visits = []
    for h in v['history']:
        lines = [('part', amount_label(p), line_total(p)) for p in h.get('parts', [])] + [('labour', l['description'], l['amount']) for l in h.get('labour', [])]
        visits.append({**h, 'date': local_date(h['created_at']).isoformat(), 'lines': lines})
    v = {**v, 'printed': today().isoformat(), 'currency': 'LKR'}
    return bills.history(v, visits, business()), v['id']


def stock_note_pdf(movement_id, with_cost=False):
    """A goods received note (GRN) or goods issue note (GIN) for one stock movement."""
    n = get('MV#' + str(movement_id), 'M')
    if not n or n['kind'] not in ('RECEIPT', 'STOCK_OUT', 'ISSUE'):
        raise missing('Stock note not found')
    n = public(n)
    n['date'] = local_date(n['created_at']).isoformat()
    product = get('PRODUCT', n['product_id']) or {}
    n.update(part_number=product.get('part_number'), location=product.get('location'))
    if not with_cost:
        n.pop('unit_cost', None)  # a printed note carries the price only when the owner asks for it
    if n.get('job_id'):
        j = get('WJOB', n['job_id'])
        n['job_registration'] = (j or {}).get('registration')
    return bills.stock_note(n, business()), (n.get('doc_no') or 'stock-note')


def stock_report_pdf(start, end, search='', category=''):
    """Owner: what happened to every item between two dates (came in, went out, returned) as a PDF."""
    rows, a, b = inventory.analysis_rows(start, end, search, category, True)
    moved = [r for r in rows if r['came_in_quantity'] or r['taken_quantity'] or r['returned_quantity'] or r['adjusted_quantity']]
    data = {'rows': moved, 'from': a.isoformat(), 'until': b.isoformat(), 'printed': today().isoformat()}
    return bills.stock_report(data, business()), 'stock-' + data['from'] + '_' + data['until']


def amount_label(p):
    return bills.q(p['quantity']) + ' x ' + p['name']


def report_pdf(start='', end=''):
    r = report(start, end)
    r['printed'] = today().isoformat()
    return bills.report(r, business()), r['from'] + '_' + r['until']
