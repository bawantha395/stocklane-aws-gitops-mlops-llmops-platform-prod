"""Workshop: vehicles, repair jobs with manual part and labour lines, invoices, payments, reports.

It is separate from stock: nothing here reads or changes inventory. A job is OPEN until its invoice
is created, then INVOICED. Every write is one transaction and edits use an optimistic revision, so
two people can never overwrite each other's work silently.

  WJOB/<id>            repair job (customer, vehicle, parts[], labour[], discount)
  VEHICLE/<REG>        one file per vehicle (owner, phone, last km, next service)
  VJOB#<REG>/<iso>#<id> the vehicle's repair history (one small row per job)
  WINV/<id>            invoice snapshot + payments
"""
import os
import re
import uuid
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from .core import COLOMBO, bad, batch_get, command, conflict, get, missing, now, num, public, put, query
from .pdf import document

BUSINESS = os.environ.get('BUSINESS_NAME', 'Montero Workshop')
LATIN = re.compile(r'[\x20-\x7e]*')
MONEY, ZERO = Decimal('0.01'), Decimal('0')
METHODS = ('CASH', 'CARD', 'BANK', 'OTHER')
CHANGED = 'Someone changed this just now. Reload it and try again.'


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


def totals(j):
    parts = sum((line_total(p) for p in j.get('parts', [])), ZERO)
    labour = sum((l['amount'] for l in j.get('labour', [])), ZERO)
    discount = j.get('discount', ZERO)
    return {'parts_total': parts, 'labour_total': labour, 'discount': discount, 'total': parts + labour - discount}


def today():
    return datetime.now(COLOMBO).date()


def local_date(iso):
    return datetime.fromisoformat(iso).astimezone(COLOMBO).date()


def clean(item):
    return {k: v for k, v in item.items() if v is not None}


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


def history_put(j):
    t = totals(j)
    return put(clean({'pk': 'VJOB#' + j['vehicle_key'], 'sk': j['created_at'] + '#' + j['id'], 'id': j['id'],
                      'created_at': j['created_at'], 'summary': j['summary'], 'status': j['status'],
                      'odometer': j.get('odometer'), 'total': t['total'], 'invoice_number': j.get('invoice_number')}))


def vehicle_fields(j):
    return {'registration': j['registration'], 'owner': j['customer'], 'phone': j['phone'], 'make': j['vehicle'],
            'last_km': j.get('odometer')}


def vehicles(search=''):
    needle = search.strip().lower()
    items = [public(v) for v in query('VEHICLE')]
    items = [v for v in items if not needle or needle in (v['registration'] + ' ' + v.get('owner', '') + ' ' + v.get('phone', '')).lower()]
    return sorted(items, key=lambda v: v['updated_at'], reverse=True)[:200]


def vehicle(key):
    key = regkey(key)
    v = get('VEHICLE', key)
    if not v:
        raise missing('Vehicle not found')
    history = [public(h) for h in sorted(query('VJOB#' + key), key=lambda h: h['sk'], reverse=True)]
    return {**public(v), 'history': history}


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


def view(j):
    return {**public(j), **totals(j)}


def jobs():
    out = []
    for j in sorted(query('WJOB'), key=lambda j: j['created_at'], reverse=True):
        v = view(j)
        v.pop('parts'), v.pop('labour')
        out.append(v)
    return out


def get_job(job_id):
    return view(job(job_id))


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
        if totals(j)['total'] < 0:
            raise bad('The discount is more than the bill')
        j['revision'], j['updated_at'] = int(current['revision']) + 1, now()
        j = clean(j)
        op = put(j, ConditionExpression='revision = :r and #s = :open', ExpressionAttributeNames={'#s': 'status'},
                 ExpressionAttributeValues={':r': current['revision'], ':open': 'OPEN'})
        return [op, vehicle_put(j['vehicle_key'], vehicle_fields(j)), history_put(j)], [CHANGED, None, None], view(j)
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
        t, created, invoice_id = totals(current), now(), str(uuid.uuid4())
        number = 'INV-' + datetime.now(COLOMBO).strftime('%Y%m%d') + '-' + invoice_id[:6].upper()
        keep = ('registration', 'vehicle_key', 'customer', 'phone', 'vehicle', 'odometer', 'summary', 'mechanic',
                'parts', 'labour', 'next_service_date', 'next_service_km')
        invoice = clean({'pk': 'WINV', 'sk': invoice_id, 'id': invoice_id, 'invoice_number': number, 'job_id': job_id,
                         **{k: current.get(k) for k in keep}, **t, 'currency': 'LKR', 'paid': ZERO, 'payments': [],
                         'status': invoice_status(t['total'], ZERO), 'revision': 0, 'approved_by': who, 'created_at': created})
        j = clean(dict(current, status='INVOICED', invoice_id=invoice_id, invoice_number=number,
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
        v.pop('parts'), v.pop('labour')
        out.append(v)
    return out


def get_invoice(invoice_id):
    return public(invoice(invoice_id))


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
        reopened = clean({k: v for k, v in j.items() if k not in ('invoice_id', 'invoice_number')})
        reopened.update(status='OPEN', revision=int(j['revision']) + 1, updated_at=now())
        ops = [put(new, ConditionExpression='revision = :r', ExpressionAttributeValues={':r': current['revision']}),
               put(reopened, ConditionExpression='revision = :r and #s = :done', ExpressionAttributeNames={'#s': 'status'},
                   ExpressionAttributeValues={':r': j['revision'], ':done': 'INVOICED'}), history_put(reopened)]
        return ops, [CHANGED, CHANGED, None], public(new)
    return command(key, 'void:' + invoice_id, who, body, build)


# ---------- PDFs ----------
def money_text(v):
    return format(Decimal(v), ',.2f')


def amount_text(v):
    return format(Decimal(v).normalize(), 'f')


def invoice_rows(i):
    rows_ = ['#' + i['invoice_number'] + '   ' + local_date(i['created_at']).isoformat() + ('   VOID' if i['status'] == 'VOID' else ''), '',
             'Customer: ' + i['customer'] + (' | ' + i['phone'] if i.get('phone') else ''),
             'Vehicle:  ' + i['registration'] + (' | ' + i['vehicle'] if i.get('vehicle') else '') +
             (' | ' + amount_text(i['odometer']) + ' km' if i.get('odometer') is not None else '')]
    if i.get('mechanic'):
        rows_.append('Mechanic: ' + i['mechanic'])
    if i.get('summary'):
        rows_.append('Work:     ' + i['summary'])
    if i['parts']:
        rows_ += ['', '#' + 'PARTS'.ljust(38) + 'QTY'.rjust(8) + 'PRICE'.rjust(16) + 'AMOUNT'.rjust(18)]
        rows_ += [p['name'][:38].ljust(38) + amount_text(p['quantity']).rjust(8) + money_text(p['unit_price']).rjust(16) +
                  money_text(line_total(p)).rjust(18) for p in i['parts']]
    if i['labour']:
        rows_ += ['', '#' + 'LABOUR'.ljust(62) + 'AMOUNT'.rjust(18)]
        rows_ += [l['description'][:62].ljust(62) + money_text(l['amount']).rjust(18) for l in i['labour']]
    rows_.append('')
    for label, value in (('Parts', i['parts_total']), ('Labour', i['labour_total']), ('Discount', -i['discount'] if i['discount'] else None)):
        if value is not None:
            rows_.append((label + ':').rjust(62) + money_text(value).rjust(18))
    rows_.append('#' + 'TOTAL (LKR):'.rjust(61) + money_text(i['total']).rjust(18))
    rows_ += [('Paid:').rjust(62) + money_text(i['paid']).rjust(18),
              '#' + 'BALANCE:'.rjust(61) + money_text(i['total'] - i['paid']).rjust(18)]
    if i['payments']:
        rows_ += ['', '#Payments']
        rows_ += [local_date(p['at']).isoformat() + '  ' + p['method'].ljust(6) + money_text(p['amount']).rjust(14) +
                  ('  ' + p['note'] if p['note'] else '') for p in i['payments']]
    return rows_ + ['', 'Thank you.']


def pdf(invoice_id):
    i = invoice(invoice_id)
    return document(BUSINESS + ' - Invoice', invoice_rows(i)), i['invoice_number']


def vehicle_pdf(key):
    v = vehicle(key)
    rows_ = ['#' + v['registration'] + (' | ' + v['make'] if v.get('make') else ''),
             'Owner: ' + v.get('owner', '') + (' | ' + v['phone'] if v.get('phone') else ''),
             'Printed: ' + today().isoformat()]
    if v.get('next_service_date') or v.get('next_service_km'):
        rows_.append('Next service: ' + (v.get('next_service_date') or '') + ('  at ' + amount_text(v['next_service_km']) + ' km' if v.get('next_service_km') else ''))
    stored = {j['id']: j for j in batch_get([('WJOB', h['id']) for h in v['history']])}
    spent = ZERO
    for h in v['history']:
        j = stored.get(h['id'])
        if not j or j['status'] == 'CANCELLED':
            continue
        t = totals(j)
        rows_ += ['', '#' + local_date(j['created_at']).isoformat() + '  ' + (amount_text(j['odometer']) + ' km  ' if j.get('odometer') is not None else '') +
                  j['status'] + (' ' + j['invoice_number'] if j.get('invoice_number') else '')]
        if j.get('summary'):
            rows_.append('  Work: ' + j['summary'])
        rows_ += ['  ' + amount_text(p['quantity']) + ' x ' + p['name'] + '  ' + money_text(line_total(p)) for p in j['parts']]
        rows_ += ['  Labour: ' + l['description'] + '  ' + money_text(l['amount']) for l in j['labour']]
        rows_.append('  Total: LKR ' + money_text(t['total']))
        if j['status'] == 'INVOICED':
            spent += t['total']
    rows_ += ['', '#Total invoiced: LKR ' + money_text(spent)]
    return document(BUSINESS + ' - Vehicle history', rows_), v['id']


# ---------- reports (owner) ----------
def report(start='', end=''):
    first = today().replace(day=1)
    start, end = day(start, 'From') or first.isoformat(), day(end, 'Until') or today().isoformat()
    sums = {k: ZERO for k in ('parts_total', 'labour_total', 'discount', 'total', 'paid')}
    by_mechanic, cars, count, outstanding = {}, set(), 0, ZERO
    for i in query('WINV'):
        if i['status'] == 'VOID':
            continue
        outstanding += i['total'] - i['paid']
        if not start <= local_date(i['created_at']).isoformat() <= end:
            continue
        count += 1
        cars.add(i['vehicle_key'])
        for k in sums:
            sums[k] += i[k]
        row = by_mechanic.setdefault(i.get('mechanic') or 'Not set', {'mechanic': i.get('mechanic') or 'Not set', 'jobs': 0, 'total': ZERO})
        row['jobs'] += 1
        row['total'] += i['total']
    return {'from': start, 'until': end, 'invoices': count, 'vehicles': len(cars), **sums, 'unpaid': sums['total'] - sums['paid'],
            'outstanding_all_time': outstanding, 'by_mechanic': sorted(by_mechanic.values(), key=lambda r: -r['total'])}


def report_pdf(start='', end=''):
    r = report(start, end)
    rows_ = ['#' + r['from'] + '  to  ' + r['until'], '',
             'Invoices:'.ljust(24) + str(r['invoices']), 'Vehicles served:'.ljust(24) + str(r['vehicles']), '',
             'Parts:'.ljust(24) + money_text(r['parts_total']).rjust(16), 'Labour:'.ljust(24) + money_text(r['labour_total']).rjust(16),
             'Discounts:'.ljust(24) + money_text(r['discount']).rjust(16), '#' + 'Billed:'.ljust(23) + money_text(r['total']).rjust(16),
             'Received:'.ljust(24) + money_text(r['paid']).rjust(16), 'Unpaid (this period):'.ljust(24) + money_text(r['unpaid']).rjust(16),
             'Unpaid (all time):'.ljust(24) + money_text(r['outstanding_all_time']).rjust(16), '', '#By mechanic']
    rows_ += [m['mechanic'][:30].ljust(34) + str(m['jobs']).rjust(6) + money_text(m['total']).rjust(18) for m in r['by_mechanic']]
    return document(BUSINESS + ' - Workshop report', rows_), r['from'] + '_' + r['until']
