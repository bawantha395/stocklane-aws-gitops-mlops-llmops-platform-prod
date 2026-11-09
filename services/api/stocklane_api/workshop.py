"""Workshop: vehicles, repair jobs with manual part and labour lines, invoices, payments, reports.

It is separate from stock: nothing here reads or changes inventory. A job is OPEN until its invoice
is created, then INVOICED. Every write is one transaction and edits use an optimistic revision, so
two people can never overwrite each other's work silently.

  WJOB/<id>             repair job (customer, vehicle, parts[], labour[], discount)
  VEHICLE/<REG>         one file per vehicle (owner, phone, last km, next service, notes)
  VJOB#<REG>/<iso>#<id> the vehicle's repair history (one small row per job, kept current on every save)
  WINV/<id>             invoice snapshot (with the business header of that day) + payments
  WSET/business         business name, address, bank details, footer, tax
"""
import re
import time
import uuid
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from . import bills
from .core import COLOMBO, bad, batch_get, command, conflict, get, missing, now, num, public, put, query

LATIN = re.compile(r'[\x20-\x7e]*')
MONEY, ZERO, HUNDRED = Decimal('0.01'), Decimal('0'), Decimal('100')
METHODS = ('CASH', 'CARD', 'BANK', 'OTHER')
CHANGED = 'Someone changed this just now. Reload it and try again.'
DEFAULT_BUSINESS = {'name': 'Ganga Motors', 'address': 'No 566, Anuradhapura 50000', 'phone': '', 'email': '', 'reg_no': '', 'bank': '',
                    'footer': 'Thank you for your business.', 'tax_name': 'VAT', 'tax_rate': ZERO}


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
    return [{'name': text(r.get('name'), 'Part name', 100, True), 'quantity': quantity(r.get('quantity', 1)),
             'unit_price': money(r.get('unit_price', 0), 'Part price')} for r in rows(value, 60, 'parts')]


def labour_in(value):
    return [{'description': text(r.get('description'), 'Labour description', 100, True),
             'amount': money(r.get('amount', 0), 'Labour amount')} for r in rows(value, 30, 'labour')]


def line_total(p):
    return (p['quantity'] * p['unit_price']).quantize(MONEY, ROUND_HALF_UP)


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


def save_business(key, who, body):
    def build():
        b = body or {}
        rate = num(b.get('tax_rate') or 0, 'Tax rate')
        if rate < 0 or rate > 50 or rate.as_tuple().exponent < -2:
            raise bad('Tax rate must be between 0 and 50 (at most 2 decimals)')
        item = {'pk': 'WSET', 'sk': 'business', 'name': text(b.get('name'), 'Business name', 60, True),
                'address': lines_text(b.get('address'), 'Address', 200), 'phone': text(b.get('phone'), 'Phone', 60),
                'email': text(b.get('email'), 'Email', 80), 'reg_no': text(b.get('reg_no'), 'Registration / tax number', 60),
                'bank': lines_text(b.get('bank'), 'Bank details', 300), 'footer': lines_text(b.get('footer'), 'Footer', 300),
                'tax_name': text(b.get('tax_name') or 'VAT', 'Tax name', 12, True), 'tax_rate': rate, 'updated_at': now(), 'updated_by': who}
        return [put(item)], [None], public(item)
    return command(key, 'save-business', who, body, build)


# ---------- vehicles ----------
def vehicle_put(key, fields, always=()):
    """Create or update the vehicle file. Empty values keep what is stored, except those in `always`."""
    current = get('VEHICLE', key)
    item = dict(current) if current else {'pk': 'VEHICLE', 'sk': key, 'id': key, 'created_at': now(), 'revision': 0}
    item.update({k: v for k, v in fields.items() if v not in (None, '')})
    for k in always:
        if fields.get(k) in (None, ''):
            item.pop(k, None)
    item['updated_at'] = now()
    item['revision'] = int(item['revision']) + 1
    if current:
        return put(item, ConditionExpression='revision = :r', ExpressionAttributeValues={':r': current['revision']})
    return put(item, ConditionExpression='attribute_not_exists(pk)')


def history_put(j, rate=ZERO):
    t = totals(j, rate)
    return put(clean({'pk': 'VJOB#' + j['vehicle_key'], 'sk': j['created_at'] + '#' + j['id'], 'id': j['id'],
                      'created_at': j['created_at'], 'summary': j['summary'], 'status': j['status'], 'odometer': j.get('odometer'),
                      'total': t['total'], 'invoice_number': j.get('invoice_number'), 'invoice_id': j.get('invoice_id')}))


def vehicle_fields(j):
    return {'registration': j['registration'], 'owner': j['customer'], 'phone': j['phone'], 'make': j['vehicle'],
            'last_km': j.get('odometer')}


def vehicles(search=''):
    needle = search.strip().lower()
    items = [public(v) for v in query('VEHICLE')]
    items = [v for v in items if not needle or needle in (v['registration'] + ' ' + v.get('owner', '') + ' ' + v.get('phone', '') + ' ' + v.get('make', '')).lower()]
    return sorted(items, key=lambda v: v['updated_at'], reverse=True)[:200]


def vehicle(key):
    """The vehicle file: details, every repair with its lines (kept current by every job save) and totals."""
    key = regkey(key)
    v = get('VEHICLE', key)
    if not v:
        raise missing('Vehicle not found')
    history = sorted(query('VJOB#' + key), key=lambda h: h['sk'], reverse=True)
    stored = {j['id']: j for j in batch_get([('WJOB', h['id']) for h in history[:40]])}
    visits, spent, dates = [], ZERO, []
    for h in history:
        row = public(h)
        j = stored.get(h['id'])
        if j:
            row['parts'] = [{'name': p['name'], 'quantity': p['quantity'], 'unit_price': p['unit_price']} for p in j['parts']]
            row['labour'] = [{'description': l['description'], 'amount': l['amount']} for l in j['labour']]
            row['mechanic'] = j.get('mechanic', '')
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
        if not fields:
            raise bad('Nothing to change')
        return [vehicle_put(key, fields)], [CHANGED], {'saved': True}
    return command(idem, 'edit-vehicle:' + key, who, body, build)


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
    out = []
    for j in sorted(query('WJOB'), key=lambda j: j['created_at'], reverse=True):
        v = view(j, rate)
        v['lines'] = len(v.pop('parts')) + len(v.pop('labour'))
        out.append(v)
    return out


def get_job(job_id):
    return view(job(job_id), business()['tax_rate'])


def create_job(key, who, body):
    def build():
        b = body or {}
        reg = text(b.get('registration'), 'Vehicle number', 20, True).upper()
        created, job_id = now(), str(uuid.uuid4())
        j = clean({'pk': 'WJOB', 'sk': job_id, 'id': job_id, 'registration': reg, 'vehicle_key': regkey(reg),
                   'customer': text(b.get('customer'), 'Customer name', 100, True), 'phone': phone(b.get('phone')),
                   'vehicle': text(b.get('vehicle'), 'Vehicle make and model', 100),
                   'odometer': km(b.get('odometer'), 'Odometer'), 'summary': text(b.get('summary'), 'Complaint', 1000),
                   'mechanic': text(b.get('mechanic'), 'Mechanic', 60), 'notes': '', 'status': 'OPEN', 'revision': 0,
                   'parts': [], 'labour': [], 'discount': ZERO, 'created_by': who, 'created_at': created, 'updated_at': created})
        return [put(j), vehicle_put(j['vehicle_key'], vehicle_fields(j)), history_put(j)], [None, None, None], view(j)
    return command(key, 'create-job', who, body, build)


def save_job(job_id, key, who, body):
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
        if 'phone' in b:
            j['phone'] = phone(b['phone'])
        if 'odometer' in b:
            j['odometer'] = km(b['odometer'], 'Odometer')
        if 'parts' in b:
            j['parts'] = parts_in(b['parts'])
        if 'labour' in b:
            j['labour'] = labour_in(b['labour'])
        if 'discount' in b:
            j['discount'] = money(b['discount'] or 0, 'Discount')
        if 'next_service_date' in b:
            j['next_service_date'] = day(b['next_service_date'], 'Next service date')
        if 'next_service_km' in b:
            j['next_service_km'] = km(b['next_service_km'], 'Next service km')
        if totals(j)['subtotal'] < 0:
            raise bad('The discount is more than the bill')
        j['revision'], j['updated_at'] = int(current['revision']) + 1, now()
        j = clean(j)
        rate = business()['tax_rate']
        op = put(j, ConditionExpression='revision = :r and #s = :open', ExpressionAttributeNames={'#s': 'status'},
                 ExpressionAttributeValues={':r': current['revision'], ':open': 'OPEN'})
        return [op, vehicle_put(j['vehicle_key'], vehicle_fields(j)), history_put(j, rate)], [CHANGED, None, None], view(j, rate)
    return command(key, 'save-job:' + job_id, who, body, build)


def cancel_job(job_id, key, who, body):
    def build():
        current = job(job_id)
        if current['status'] != 'OPEN':
            raise conflict('Only an open job can be cancelled')
        j = dict(current, status='CANCELLED', revision=int(current['revision']) + 1, updated_at=now())
        op = put(j, ConditionExpression='revision = :r and #s = :open', ExpressionAttributeNames={'#s': 'status'},
                 ExpressionAttributeValues={':r': current['revision'], ':open': 'OPEN'})
        return [op, history_put(j)], [CHANGED, None], view(j)
    return command(key, 'cancel-job:' + job_id, who, body, build)


# ---------- invoices ----------
def invoice_status(total, paid):
    return 'PAID' if paid >= total else 'PARTIAL' if paid > 0 else 'UNPAID'


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
        number = 'INV-' + datetime.now(COLOMBO).strftime('%Y%m%d') + '-' + invoice_id[:6].upper()
        keep = ('registration', 'vehicle_key', 'customer', 'phone', 'vehicle', 'odometer', 'summary', 'mechanic', 'parts', 'labour',
                'next_service_date', 'next_service_km')
        invoice = clean({'pk': 'WINV', 'sk': invoice_id, 'id': invoice_id, 'invoice_number': number, 'job_id': job_id,
                         **{k: current.get(k) for k in keep}, **t, 'tax_name': shop['tax_name'], 'tax_rate': rate, 'currency': 'LKR',
                         'paid': ZERO, 'payments': [], 'status': invoice_status(t['total'], ZERO), 'revision': 0, 'approved_by': who,
                         'created_at': created, 'business': {k: v for k, v in shop.items() if k in DEFAULT_BUSINESS}})
        j = clean(dict(stamped, status='INVOICED', invoice_id=invoice_id, invoice_number=number,
                       revision=int(current['revision']) + 1, updated_at=created))
        op = put(j, ConditionExpression='revision = :r and #s = :open', ExpressionAttributeNames={'#s': 'status'},
                 ExpressionAttributeValues={':r': current['revision'], ':open': 'OPEN'})
        fields = {**vehicle_fields(j), 'next_service_date': j.get('next_service_date'), 'next_service_km': j.get('next_service_km')}
        ops = [op, put(invoice), vehicle_put(j['vehicle_key'], fields, always=('next_service_date', 'next_service_km')), history_put(j)]
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
                   status=invoice_status(current['total'], paid), revision=int(current['revision']) + 1)
        op = put(new, ConditionExpression='revision = :r', ExpressionAttributeValues={':r': current['revision']})
        return [op], [CHANGED], public(new)
    return command(key, 'pay:' + invoice_id, who, body, build)


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
                   ExpressionAttributeValues={':r': j['revision'], ':done': 'INVOICED'}), history_put(reopened, business()['tax_rate'])]
        return ops, [CHANGED, CHANGED, None], public(new)
    return command(key, 'void:' + invoice_id, who, body, build)


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
    return {**out, 'open_jobs': open_jobs[:12], 'open_count': len(open_jobs), 'unpaid_count': len(unpaid),
            'unpaid_total': sum((i['total'] - i['paid'] for i in unpaid), ZERO),
            'oldest_unpaid_days': max((age_days(i['created_at']) for i in unpaid), default=0), 'due_count': len(service_due())}


# ---------- reports (owner) ----------
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
        if balance > 0:
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
        row = by_mechanic.setdefault(name, {'mechanic': name, 'jobs': 0, 'total': ZERO})
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


def amount_label(p):
    return bills.q(p['quantity']) + ' x ' + p['name']


def report_pdf(start='', end=''):
    r = report(start, end)
    r['printed'] = today().isoformat()
    return bills.report(r, business()), r['from'] + '_' + r['until']
