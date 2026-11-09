"""Stock rules: catalogue, receipts, issues, returns, people, reports.

Data (one DynamoDB table, pk/sk):
  PRODUCT/<id>            catalogue item and live quantity
  MOVE/<iso>#<id>         movement ledger, newest last (for the recent list)
  MV#<id>/M               the same movement by id; issues and handovers track `returned` here
  JOBMV#<job>/<iso>#<id>  movements of one repair job
  DAY/<date>#<product>    per Colombo day totals (added, taken, returned) for reports and forecasts
  PERSON/<id>, UNIQ/...   people at the counter, and unique SKU / barcode / part number / name claims
Every change is one DynamoDB transaction: quantity, ledger, day totals and the idempotency record
commit together or not at all.
"""
import json
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import boto3

from .core import (COLOMBO, ApiError, bad, batch_get, check, command, conflict, delete, get, missing, now, num,
                   public, put, query, unique, update, dumps)

ZERO = Decimal(0)
KINDS = {'OPENING', 'RECEIPT', 'ISSUE', 'RETURN', 'STOCK_OUT'}
OUT_KINDS = {'ISSUE', 'STOCK_OUT'}
_cache = {'until': 0, 'value': None}


# ---------- helpers ----------
def text(value, label, limit=180, required=True):
    value = '' if value is None else str(value).strip()
    if required and not value:
        raise bad(label + ' is required (maximum ' + str(limit) + ' characters)')
    if len(value) > limit:
        raise bad('One or more catalogue fields are too long')
    return value


def non_negative(value, label):
    value = num(value, label)
    if value < 0:
        raise bad('Prices and opening/reorder quantities must be zero or greater')
    return value


def part_key(value):
    return value.strip().upper() if value and value.strip() else None


def product_view(item):
    return public(item, drop=('pk', 'sk', 'ttl'))


def active_products():
    return [product_view(p) for p in query('PRODUCT') if not p.get('archived')]


def load_product(product_id):
    item = get('PRODUCT', str(product_id)) if product_id else None
    if not item:
        raise missing('Product not found')
    return item


def day_of(iso):
    return datetime.fromisoformat(iso).astimezone(COLOMBO).date().isoformat()


def announce(product):
    """Tell the vision function a catalogue photo was approved (best effort, never blocks stock)."""
    function = os.environ.get('VISION_FUNCTION')
    if not function or not product.get('image_id'):
        return
    try:
        boto3.client('lambda').invoke(FunctionName=function, InvocationType='Event',
                                      Payload=json.dumps({'action': 'index', 'productId': product['id']}).encode())
    except Exception as error:  # the 30-minute reconcile and the reindex action repair a missed call
        print('vision notification skipped:', type(error).__name__)


# ---------- reads ----------
def products():
    return sorted(active_products(), key=lambda p: (p['created_at'], p['sku']), reverse=True)


def archived_products():
    return sorted([product_view(p) for p in query('PRODUCT') if p.get('archived')], key=lambda p: p['sku'])


def catalogue():
    if time.monotonic() > _cache['until']:
        keys = ('id', 'sku', 'name', 'category', 'brand', 'grade', 'capacity', 'barcode', 'unit', 'selling_price',
                'reorder_level', 'image_id', 'part_number', 'location', 'archived')
        rows = sorted(({k: p.get(k) for k in keys} for p in active_products()), key=lambda p: p['sku'])
        _cache.update(value=rows, until=time.monotonic() + 30)
    return _cache['value']


def movements():
    return [public(m) for m in query('MOVE', forward=False, limit=200)]


def job_movements(job_id):
    return [public(m) for m in query('JOBMV#' + job_id)]


def archive_audit(product_id, who, action, details):
    return put({'pk': 'AUDIT#' + product_id, 'sk': now() + '#' + uuid.uuid4().hex[:8], 'actor': who,
                'action': action, 'details': dumps(details)})


# ---------- people ----------
def people():
    return sorted(({'id': p['id'], 'name': p['name']} for p in query('PERSON') if p.get('active')),
                  key=lambda p: p['name'])


def add_person(key, who, body):
    def build():
        name = ' '.join(str((body or {}).get('name') or '').split())
        if not name or len(name) > 80:
            raise bad('Enter a name (maximum 80 characters)')
        person = {'pk': 'PERSON', 'sk': uuid.uuid4().hex, 'name': name, 'active': True, 'created_at': now()}
        person['id'] = person['sk']
        return ([put(person), unique('person', name.lower())], [None, name + ' is already on the list'],
                {'id': person['id'], 'name': name, 'active': True})
    return command(key, 'add-person', who, body, build)


def active_person(person_id):
    person = get('PERSON', str(person_id)) if person_id else None
    if not person:
        raise bad('Choose who receives the part')
    if not person.get('active'):
        raise conflict(person['name'] + ' is no longer on the list')
    return person


def remove_person(person_id):
    person = get('PERSON', person_id)
    if not person:
        raise missing('Person not found')
    from .core import table
    table().update_item(Key={'pk': 'PERSON', 'sk': person_id}, UpdateExpression='SET active = :f',
                        ExpressionAttributeValues={':f': False})
    return {'id': person_id, 'active': False}


def handovers(person_id):
    """Parts handed to one person at the counter in the last 30 days, with what is still out."""
    active_person(person_id)
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    rows = [m for m in query('MOVE', gte=since) if m['kind'] == 'STOCK_OUT' and m.get('receiver_id') == person_id]
    rows = rows[-100:][::-1]
    details = {m['id']: m for m in batch_get([('MV#' + r['id'], 'M') for r in rows])} if rows else {}
    open_rows = []
    for r in rows:
        returned = next((d['returned'] for d in details.values() if d['id'] == r['id']), ZERO)
        outstanding = r['quantity'] - returned
        if outstanding > 0:
            open_rows.append({'id': r['id'], 'product_id': r['product_id'], 'sku': r['sku'], 'name': r['name'],
                              'unit': r['unit'], 'quantity': r['quantity'], 'created_at': r['created_at'],
                              'returned': returned, 'outstanding': outstanding})
    return open_rows


# ---------- catalogue ----------
def create_product(key, who, body):
    def build():
        p = body or {}
        part = text(p.get('partNumber'), 'Manufacturer part number')
        sku = text(p.get('sku'), 'SKU').upper()
        name, category, brand = text(p.get('name'), 'Name'), text(p.get('category'), 'Category', 80), text(p.get('brand'), 'Brand', 100)
        grade, capacity = text(p.get('grade'), 'Grade', 80, False), text(p.get('capacity'), 'Capacity', 60, False)
        location = text(p.get('location'), 'Location', 180, False)
        unit = p.get('unit')
        if unit not in ('UNIT', 'LITRE'):
            raise bad('Unit must be UNIT or LITRE')
        price, reorder, opening = non_negative(p.get('sellingPrice'), 'Price'), non_negative(p.get('reorderLevel'), 'Reorder level'), non_negative(p.get('openingQuantity'), 'Opening quantity')
        if unit == 'UNIT' and opening != opening.to_integral_value():
            raise bad('Sealed units require a whole number')
        barcode = (p.get('barcode') or '').strip() or None
        product_id = str(uuid.uuid4())
        created = now()
        item = {'pk': 'PRODUCT', 'sk': product_id, 'id': product_id, 'sku': sku, 'name': name, 'category': category,
                'brand': brand, 'grade': grade, 'capacity': capacity, 'unit': unit, 'quantity': opening,
                'selling_price': price, 'reorder_level': reorder, 'created_at': created, 'archived': False,
                'manufacturer_key': brand.upper(), 'part_number': part_key(part), 'location': location}
        if barcode:
            item['barcode'] = barcode
        if p.get('imageId'):
            item['image_id'] = str(p['imageId'])
        ops, labels = [put(item), unique('sku', sku), unique('part', item['manufacturer_key'] + '|' + item['part_number'])], \
            [None, 'SKU ' + sku + ' already exists', 'This manufacturer part number already exists']
        if barcode:
            ops.append(unique('barcode', barcode))
            labels.append('This barcode already belongs to another item')
        result = product_view(item)
        if opening > 0:
            extra, _ = movement_items(item, 'OPENING', opening, price, None, None, who, 'Approved initial physical count', None, None, created)
            ops += extra
            labels += [None] * len(extra)
            result['opening_movement'] = True
        return ops, labels, result

    result = command(key, 'create-product', who, body, build)
    announce(result)
    _cache['until'] = 0
    return {k: v for k, v in result.items() if k != 'opening_movement'}


def edit_product(key, product_id, who, body):
    def build():
        item = load_product(product_id)
        p = body or {}
        name, category, brand = text(p.get('name'), 'Name'), text(p.get('category'), 'Category', 80), text(p.get('brand'), 'Manufacturer', 100)
        part = text(p.get('partNumber'), 'Manufacturer part number')
        reorder = non_negative(p.get('reorderLevel'), 'Reorder level')
        updated = dict(item, name=name, category=category, brand=brand, manufacturer_key=brand.upper(),
                       grade=text(p.get('grade'), 'Grade', 80, False), capacity=text(p.get('capacity'), 'Capacity', 60, False),
                       part_number=part_key(part), location=text(p.get('location'), 'Location', 180, False), reorder_level=reorder)
        ops = [put(updated, ConditionExpression='quantity = :q', ExpressionAttributeValues={':q': item['quantity']}),
               archive_audit(product_id, who, 'EDIT', p)]
        labels = [None, None]
        old, new = item['manufacturer_key'] + '|' + (item.get('part_number') or ''), updated['manufacturer_key'] + '|' + updated['part_number']
        if old != new:
            ops += [delete('UNIQ', 'part#' + old), unique('part', new)]
            labels += [None, 'This manufacturer part number already exists']
        return ops, labels, product_view(updated)
    result = command(key, 'edit-product:' + product_id, who, body, build)
    announce(result)
    _cache['until'] = 0
    return result


def archive_product(key, product_id, who, body):
    def build():
        item = load_product(product_id)
        archived = bool((body or {}).get('archived'))
        if archived and item['quantity'] != 0:
            raise conflict('Record the physical stock OUT before archiving a product with remaining stock')
        updated = dict(item, archived=archived)
        return ([put(updated, ConditionExpression='quantity = :q', ExpressionAttributeValues={':q': item['quantity']}),
                 archive_audit(product_id, who, 'ARCHIVE' if archived else 'RESTORE', body)], [None, None], product_view(updated))
    result = command(key, 'archive-product:' + product_id, who, body, build)
    _cache['until'] = 0
    return result


# ---------- movements ----------
def movement_items(product, kind, quantity, price, job_id, issue_id, who, note, receiver, receiver_name, created):
    """Ledger rows for one movement. The product quantity row is written by the caller."""
    movement_id = str(uuid.uuid4())
    row = {'id': movement_id, 'product_id': product['id'], 'kind': kind, 'quantity': quantity, 'unit_price': price,
           'actor': who, 'note': note, 'created_at': created, 'sku': product['sku'], 'name': product['name'],
           'unit': product['unit']}
    for name, value in (('job_id', job_id), ('issue_id', issue_id), ('receiver_id', receiver), ('receiver_name', receiver_name)):
        if value:
            row[name] = value
    marker = created + '#' + movement_id
    items = [put(dict(row, pk='MOVE', sk=marker)), put(dict(row, pk='MV#' + movement_id, sk='M', returned=ZERO))]
    if job_id:
        items.append(put(dict(row, pk='JOBMV#' + job_id, sk=marker)))
    added = quantity if kind in ('OPENING', 'RECEIPT', 'RETURN') else ZERO
    taken = quantity if kind in OUT_KINDS else ZERO
    returned = quantity if kind == 'RETURN' else ZERO
    items.append(update('DAY', day_of(created) + '#' + product['id'],
                        'SET sku = :s, #n = :nm, #u = :u, product_id = :p ADD added :a, taken :t, returned :r',
                        {':s': product['sku'], ':nm': product['name'], ':u': product['unit'], ':p': product['id'],
                         ':a': added, ':t': taken, ':r': returned}, names={'#n': 'name', '#u': 'unit'}))
    return items, movement_id


def record_movement(key, who, body):
    def build():
        m = body or {}
        kind = m.get('kind')
        if kind == 'OPENING':
            raise bad('Opening stock is recorded during product registration')
        if kind not in KINDS:
            raise bad('Unsupported movement type')
        quantity = num(m.get('quantity'))
        if quantity <= 0 or quantity.as_tuple().exponent < -3:
            raise bad('Quantity must be positive, with at most 3 decimals')
        note = text(m.get('note'), 'Note', 500, False)
        job_id, issue_id, receiver_id = m.get('jobId'), m.get('issueId'), m.get('receiverId')
        counter_return = kind == 'RETURN' and not job_id
        on_job = kind == 'ISSUE' or (kind == 'RETURN' and not counter_return)
        if receiver_id and kind != 'STOCK_OUT' and not counter_return:
            raise bad('Only a counter handover or its return names a receiver')
        receiver_name = None
        if kind == 'STOCK_OUT' and receiver_id:
            person = active_person(receiver_id)
            receiver_name = person['name']
        if kind == 'STOCK_OUT' and (job_id or issue_id):
            raise bad('Stock OUT does not use a repair job')
        ops, labels = [], []
        if on_job:
            if not job_id:
                raise bad('A repair job is required')
            job = get('JOB', str(job_id))
            if not job:
                raise conflict('Repair job is not registered with inventory')
            if job['state'] != 'OPEN':
                raise conflict('This job is frozen for invoicing; stock changes are blocked')
            ops.append(update('JOB', str(job_id), 'ADD revision :one', {':one': 1, ':open': 'OPEN'},
                              names={'#s': 'state'}, condition='#s = :open'))
            labels.append(None)
        product = load_product(m.get('productId'))
        if product.get('archived'):
            raise conflict('This product is archived')
        if product['unit'] == 'UNIT' and quantity != quantity.to_integral_value():
            raise bad('Sealed units require a whole number')
        price = product['selling_price']
        if kind == 'RETURN' and not (counter_return and not issue_id):
            issue = get('MV#' + str(issue_id), 'M') if issue_id else None
            wanted = 'STOCK_OUT' if counter_return else 'ISSUE'
            if (not issue or issue['kind'] != wanted or issue['product_id'] != product['id']
                    or (not counter_return and issue.get('job_id') != job_id)
                    or (counter_return and not issue.get('receiver_id'))):
                raise conflict('Select the part this person received' if counter_return else 'Select the original issue for this return')
            if counter_return:
                receiver_id = issue['receiver_id']
                receiver_name = issue.get('receiver_name')
            if quantity + issue['returned'] > issue['quantity']:
                raise conflict('Return exceeds the outstanding issued quantity')
            price = issue['unit_price']
            ops.append(update('MV#' + issue_id, 'M', 'ADD returned :q', {':q': quantity, ':max': issue['quantity'] - quantity},
                              condition='returned <= :max'))
            labels.append(None)
        elif kind == 'RETURN':
            price = ZERO
        balance = product['quantity'] + (-quantity if kind in OUT_KINDS else quantity)
        if balance < 0:
            raise conflict('Insufficient stock for this issue')
        ops.append(update('PRODUCT', product['id'], 'SET quantity = :new',
                          {':new': balance, ':old': product['quantity'], ':nf': False},
                          condition='quantity = :old and archived = :nf'))
        labels.append(None)
        created = now()
        rows, mid = movement_items(product, kind, quantity, price, job_id if on_job else None, issue_id, who, note,
                              receiver_id if (kind == 'STOCK_OUT' or counter_return) else None, receiver_name, created)
        ops += rows
        labels += [None] * len(rows)
        result = {'id': mid, 'product_id': product['id'], 'kind': kind, 'quantity': quantity, 'unit_price': price,
                  'job_id': job_id if on_job else None, 'issue_id': issue_id, 'actor': who, 'note': note, 'created_at': created,
                  'receiver_id': receiver_id, 'sku': product['sku'], 'name': product['name'], 'unit': product['unit'],
                  'balance': balance}
        return ops, labels, result
    result = command(key, 'movement', who, body, build)
    _cache['until'] = 0
    return result


# ---------- jobs (used by the workshop) ----------
def job_snapshot(job_id):
    job = get('JOB', job_id)
    if not job:
        raise conflict('Repair job is not registered with inventory')
    lines = {}
    for m in query('JOBMV#' + job_id):
        if m['kind'] not in ('ISSUE', 'RETURN'):
            continue
        k = (m['product_id'], m['unit_price'])
        line = lines.setdefault(k, {'product_id': m['product_id'], 'sku': m['sku'], 'name': m['name'], 'unit': m['unit'],
                                    'unit_price': m['unit_price'], 'quantity': ZERO})
        line['quantity'] += m['quantity'] if m['kind'] == 'ISSUE' else -m['quantity']
    return {'jobId': job_id, 'revision': job['revision'], 'state': job['state'],
            'lines': [line for line in lines.values() if line['quantity'] > 0]}


# ---------- reports ----------
def _colombo_date(value, label):
    try:
        instant = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        raise bad('Use valid ISO date/time bounds') from None
    if instant.tzinfo is None:
        raise bad('Use valid ISO date/time bounds')
    return instant


def _bounds(start, end):
    first, last = _colombo_date(start, 'from'), _colombo_date(end, 'until')
    if first >= last:
        raise bad('End time must follow start time')
    if (last - first).days > 3660:
        raise bad('Choose a range of ten years or less')
    return first.astimezone(COLOMBO).date().isoformat(), last.astimezone(COLOMBO).date().isoformat(), first, last


def analysis(start, end, search='', category='', archived=True, page=0):
    """Opening, added, taken and closing quantities per item. Days are Asia/Colombo days."""
    first, last, a, b = _bounds(start, end)
    if page < 0 or page > 100000:
        raise bad('Invalid page')
    word, category = (search or '').strip().lower(), (category or '').strip().lower()
    chosen = []
    for p in sorted(query('PRODUCT'), key=lambda x: x['sku']):
        haystack = ' '.join(str(p.get(k) or '') for k in ('name', 'sku', 'brand', 'part_number', 'location')).lower()
        if (archived or not p.get('archived')) and word in haystack and (not category or p['category'].lower() == category):
            chosen.append(p)
    totals = {}
    for d in query('DAY', lt=last):
        t = totals.setdefault(d['product_id'], [ZERO, ZERO, ZERO])
        net = d['added'] - d['taken']
        if d['sk'][:10] < first:
            t[0] += net
        else:
            t[1] += d['added']
            t[2] += d['taken']
    rows = []
    for p in chosen[page * 100:page * 100 + 100]:
        opening, added, taken = totals.get(p['id'], [ZERO, ZERO, ZERO])
        rows.append({'id': p['id'], 'sku': p['sku'], 'name': p['name'], 'brand': p['brand'], 'part_number': p.get('part_number'),
                     'category': p['category'], 'location': p.get('location', ''), 'unit': p['unit'], 'archived': bool(p.get('archived')),
                     'available_now': p['quantity'], 'opening_quantity': opening, 'added_quantity': added,
                     'taken_quantity': taken, 'closing_quantity': opening + added - taken})
    return {'rows': rows, 'total': len(chosen), 'page': page, 'pageSize': 100, 'from': a.isoformat(), 'until': b.isoformat(), 'asOf': now()}


def daily(start, end):
    first, last, _, _ = _bounds(start, end)
    return [{'date': d['sk'][:10], 'product_id': d['product_id'], 'sku': d['sku'], 'name': d['name'], 'unit': d['unit'],
             'out_quantity': d['taken'], 'return_quantity': d['returned']}
            for d in query('DAY', between=(first, last)) if d['sk'][:10] < last]


def history_snapshot(start_text, confirmed, who):
    """Whole-ledger usage by complete Colombo day, for the forecast. Never invents history."""
    if not confirmed:
        raise bad('Confirm complete stock tracking for the selected history period')
    try:
        start = datetime.fromisoformat(start_text).date() if start_text else None
    except ValueError:
        start = None
    if start is None:
        raise bad('Use a valid history start date')
    as_of = datetime.now(timezone.utc)
    until = as_of.astimezone(COLOMBO).date()
    if start > until or start < until - timedelta(days=1095):
        raise bad('Choose a history start on or before today, within three years')
    catalogue_rows = [p for p in query('PRODUCT') if not p.get('archived')]
    if len(catalogue_rows) > 1000:
        raise bad('Forecast export supports at most 1000 active items')
    days, totals = {}, {}
    for d in query('DAY'):
        day = datetime.fromisoformat(d['sk'][:10]).date()
        if day > until:
            raise bad('Future dated movements must be corrected before forecasting')
        days.setdefault(d['product_id'], {})[day] = (d['added'] - d['taken'], d['taken'])
        totals[d['product_id']] = totals.get(d['product_id'], ZERO) + d['added'] - d['taken']
    rows = []
    for p in catalogue_rows:
        if p['quantity'] != totals.get(p['id'], ZERO):
            raise bad('Ledger and available stock differ; reconcile stock before forecasting')
        registered = datetime.fromisoformat(p['created_at']).astimezone(COLOMBO).date() + timedelta(days=1)
        first = min(max(registered, start), until)
        history = days.get(p['id'], {})
        balance = sum((v[0] for k, v in history.items() if k < first), ZERO)
        usage, in_stock = [], []
        day = first
        while day < until:
            delta, out = history.get(day, (ZERO, ZERO))
            available = balance > 0
            balance += delta
            usage.append(out)
            in_stock.append(available and balance > 0)
            day += timedelta(days=1)
        rows.append({'id': p['id'], 'sku': p['sku'], 'name': p['name'], 'unit': p['unit'], 'start': first.isoformat(),
                     'usage': usage, 'inStock': in_stock})
    return {'schemaVersion': 1, 'timezone': 'Asia/Colombo', 'historyConfirmed': True, 'historyFrom': start.isoformat(),
            'historyUntil': until.isoformat(), 'asOf': as_of.isoformat(), 'confirmedBy': who, 'products': rows}
