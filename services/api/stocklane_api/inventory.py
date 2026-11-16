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

from .core import (COLOMBO, ApiError, bad, batch_get, check, command, conflict, delete, emails, get, missing, now, num,
                   public, put, query, unique, update, dumps)

ZERO = Decimal(0)
KINDS = {'OPENING', 'RECEIPT', 'ISSUE', 'RETURN', 'STOCK_OUT', 'COUNT'}
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
def products(owner=True):
    rows = sorted(active_products(), key=lambda p: (p['created_at'], p['sku']), reverse=True)
    return rows if owner else hide_cost(rows)


def archived_products():
    return sorted([product_view(p) for p in query('PRODUCT') if p.get('archived')], key=lambda p: p['sku'])


def catalogue():
    if time.monotonic() > _cache['until']:
        keys = ('id', 'sku', 'name', 'category', 'brand', 'grade', 'capacity', 'barcode', 'unit', 'selling_price',
                'reorder_level', 'image_id', 'part_number', 'location', 'archived', 'supplier')
        rows = sorted(({k: p.get(k) for k in keys} for p in active_products()), key=lambda p: p['sku'])
        _cache.update(value=rows, until=time.monotonic() + 30)
    return _cache['value']


def movements(owner=True):
    who = emails()
    rows = [dict(public(m), actor_email=who.get(m.get('actor'))) for m in query('MOVE', forward=False, limit=200)]
    return rows if owner else hide_cost(rows)


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


# ---------- shelves and categories ----------
# The owner makes the lists once (Settings); an item form then picks from them. A rack has levels ("Rack 1" with A, B, C), and the
# shelf written on a part is "Rack 1-A". While no list exists the fields stay free text, so a shop can start without them.
def shelf_label(rack, level=''):
    return rack + '-' + level if level else rack


def shelf_names(racks):
    return [shelf_label(r['name'], l) for r in racks for l in (r.get('levels') or ['']) ]


def stores_row():
    return get('STORES', 'main') or {'racks': [], 'categories': [], 'revision': 0}


def stores_view(row=None):
    row = row or stores_row()
    return {'racks': row.get('racks') or [], 'categories': row.get('categories') or [], 'shelves': shelf_names(row.get('racks') or []),
            'revision': int(row.get('revision') or 0)}


def clean_stores(body):
    racks, seen = [], set()
    raw = body.get('racks') or []
    if not isinstance(raw, list) or len(raw) > 100:
        raise bad('Up to 100 racks')
    for r in raw:
        if not isinstance(r, dict):
            raise bad('Check the racks')
        name = text(r.get('name'), 'Rack name', 40, True)
        if name.lower() in seen:
            raise bad('"%s" is in the list twice' % name)
        seen.add(name.lower())
        levels, lseen = [], set()
        raw_levels = r.get('levels') or []
        if not isinstance(raw_levels, list) or len(raw_levels) > 20:
            raise bad('Up to 20 levels on a rack')
        for l in raw_levels:
            level = text(l, 'Level', 12, True)
            if level.lower() in lseen:
                raise bad('"%s" is on %s twice' % (level, name))
            lseen.add(level.lower())
            levels.append(level)
        racks.append({'name': name, 'levels': levels})
    cats, cseen = [], set()
    raw = body.get('categories') or []
    if not isinstance(raw, list) or len(raw) > 150:
        raise bad('Up to 150 categories')
    for c in raw:
        name = text(c, 'Category', 80, True)
        if name.lower() in cseen:
            raise bad('"%s" is in the list twice' % name)
        cseen.add(name.lower())
        cats.append(name)
    shelves = shelf_names(racks)
    if len({x.lower() for x in shelves}) != len(shelves):
        raise bad('Two shelves have the same name')
    return racks, cats


def stores_save(key, who, body):
    """Owner: the whole list of racks (with levels) and categories. A shelf or category that parts still use cannot be removed."""
    def build():
        racks, cats = clean_stores(body or {})
        old = stores_row()
        want = {x.lower() for x in shelf_names(racks)}
        want_c = {x.lower() for x in cats}
        gone = [x for x in shelf_names(old.get('racks') or []) if x.lower() not in want]
        gone_c = [x for x in old.get('categories') or [] if x.lower() not in want_c]
        if gone or gone_c:
            used = active_products()
            busy_s = sorted({x for x in gone if any((p.get('location') or '').lower() == x.lower() for p in used)})
            busy_c = sorted({x for x in gone_c if any((p.get('category') or '').lower() == x.lower() for p in used)})
            if busy_s or busy_c:
                raise conflict('Parts still use ' + ', '.join(busy_s + busy_c) + '. Move those parts first, then remove it')
        row = {'pk': 'STORES', 'sk': 'main', 'racks': racks, 'categories': cats, 'revision': int(old.get('revision') or 0) + 1, 'updated_at': now(), 'updated_by': who}
        cond = {'ConditionExpression': 'revision = :r', 'ExpressionAttributeValues': {':r': old['revision']}} if old.get('pk') else {'ConditionExpression': 'attribute_not_exists(pk)'}
        return [put(row, **cond)], [None], stores_view(row)
    return command(key, 'stores', who, body, build)


def stores_add(key, who, body):
    """Owner: add one rack, one level on a rack, or one category from the item form, without touching the rest of the list."""
    def build():
        b = body or {}
        old = stores_row()
        racks = [dict(r, levels=list(r.get('levels') or [])) for r in old.get('racks') or []]
        cats = list(old.get('categories') or [])
        kind = b.get('kind')
        if kind == 'category':
            cats.append(text(b.get('name'), 'Category', 80, True))
        elif kind == 'rack':
            racks.append({'name': text(b.get('name'), 'Rack name', 40, True), 'levels': [text(l, 'Level', 12, True) for l in (b.get('levels') or [])]})
        elif kind == 'level':
            rack = next((r for r in racks if r['name'].lower() == str(b.get('rack') or '').lower()), None)
            if not rack:
                raise missing('Rack not found')
            rack['levels'].append(text(b.get('level'), 'Level', 12, True))
        else:
            raise bad('Add a rack, a level or a category')
        racks, cats = clean_stores({'racks': racks, 'categories': cats})
        row = {'pk': 'STORES', 'sk': 'main', 'racks': racks, 'categories': cats, 'revision': int(old.get('revision') or 0) + 1, 'updated_at': now(), 'updated_by': who}
        cond = {'ConditionExpression': 'revision = :r', 'ExpressionAttributeValues': {':r': old['revision']}} if old.get('pk') else {'ConditionExpression': 'attribute_not_exists(pk)'}
        return [put(row, **cond)], [None], stores_view(row)
    return command(key, 'stores-add', who, body, build)


def listed(location, category, keep=()):
    """When the owner has made the lists, a part's shelf and category must come from them (a value it already has may stay).
    Returns the two values written the way the list spells them."""
    row = stores_row()
    shelves, cats = shelf_names(row.get('racks') or []), row.get('categories') or []
    if location and shelves and location not in keep:
        hit = next((x for x in shelves if x.lower() == location.lower()), None)
        if not hit:
            raise bad('Pick a shelf from the list. The owner adds new shelves in Settings')
        location = hit
    if category and cats and category not in keep:
        hit = next((x for x in cats if x.lower() == category.lower()), None)
        if not hit:
            raise bad('Pick a category from the list. The owner adds new categories in Settings')
        category = hit
    return location, category


# ---------- catalogue ----------
def create_product(key, who, body):
    def build():
        p = body or {}
        part = text(p.get('partNumber'), 'Manufacturer part number')
        sku = text(p.get('sku'), 'SKU').upper()
        name, category, brand = text(p.get('name'), 'Name'), text(p.get('category'), 'Category', 80), text(p.get('brand'), 'Brand', 100)
        grade, capacity = text(p.get('grade'), 'Grade', 80, False), text(p.get('capacity'), 'Capacity', 60, False)
        location = text(p.get('location'), 'Location', 180, False)
        location, category = listed(location, category)
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
        if text(p.get('supplier'), 'Supplier', 100, False):
            item['supplier'] = text(p.get('supplier'), 'Supplier', 100, False)
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
        new_location, category = listed(text(p.get('location'), 'Location', 180, False), category, keep=(item.get('location') or '', item.get('category') or ''))
        updated = dict(item, name=name, category=category, brand=brand, manufacturer_key=brand.upper(),
                       grade=text(p.get('grade'), 'Grade', 80, False), capacity=text(p.get('capacity'), 'Capacity', 60, False),
                       part_number=part_key(part), location=new_location, reorder_level=reorder)
        if 'supplier' in p:
            updated['supplier'] = text(p.get('supplier'), 'Supplier', 100, False)
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
DOCS = {'RECEIPT': 'GRN', 'STOCK_OUT': 'GIN', 'ISSUE': 'GIN'}  # goods received note, goods issue note
RUNNING = ('RECEIPT', 'STOCK_OUT')  # these notes are numbered in a running series (GRN-0001, GIN-0001); a part put on a job is named by the job
MAX_DOC_LINES = 15  # one transaction holds 100 writes and each line needs 5


def next_doc_no(kind):
    """The next running note number (GRN-0001 ...). The counter row changes in the same transaction as the note, and only if
    nobody took that number first, so two people saving at once never share a number (the loser is retried by command())."""
    seq = get('DOCSEQ', kind)
    n = int(seq['n']) + 1 if seq else 1
    row = {'pk': 'DOCSEQ', 'sk': kind, 'n': n, 'updated_at': now()}
    op = put(row, ConditionExpression='n = :o', ExpressionAttributeValues={':o': seq['n']}) if seq else put(row, ConditionExpression='attribute_not_exists(pk)')
    return '%s-%04d' % (DOCS[kind], n), op


def movement_items(product, kind, quantity, price, job_id, issue_id, who, note, receiver, receiver_name, created, extra=None, doc_no=None, movement_id=None):
    """Ledger rows for one movement. The product quantity row is written by the caller."""
    movement_id = movement_id or str(uuid.uuid4())
    row = {'id': movement_id, 'product_id': product['id'], 'kind': kind, 'quantity': quantity, 'unit_price': price,
           'actor': who, 'note': note, 'created_at': created, 'sku': product['sku'], 'name': product['name'],
           'unit': product['unit']}
    for name, value in (('job_id', job_id), ('issue_id', issue_id), ('receiver_id', receiver), ('receiver_name', receiver_name)):
        if value:
            row[name] = value
    if kind in DOCS and not (note or '').startswith('Undo'):
        row['doc_no'] = doc_no or DOCS[kind] + '-' + day_of(created).replace('-', '') + '-' + movement_id[:4].upper()
    row.update({k: v for k, v in (extra or {}).items() if v})
    marker = created + '#' + movement_id
    items = [put(dict(row, pk='MOVE', sk=marker)), put(dict(row, pk='MV#' + movement_id, sk='M', returned=ZERO))]
    if job_id:
        items.append(put(dict(row, pk='JOBMV#' + job_id, sk=marker)))
    added = quantity if kind in ('OPENING', 'RECEIPT', 'RETURN') else ZERO
    taken = quantity if kind in OUT_KINDS else ZERO
    returned = quantity if kind == 'RETURN' else ZERO
    # A count correction is not a purchase or a sale: it moves the books to match the shelf, so it has its own signed total
    # and never counts as demand for the forecast.
    adjusted = quantity if kind == 'COUNT_IN' else -quantity if kind == 'COUNT_OUT' else ZERO
    items.append(update('DAY', day_of(created) + '#' + product['id'],
                        'SET sku = :s, #n = :nm, #u = :u, product_id = :p ADD added :a, taken :t, returned :r, adjusted :j',
                        {':s': product['sku'], ':nm': product['name'], ':u': product['unit'], ':p': product['id'],
                         ':a': added, ':t': taken, ':r': returned, ':j': adjusted}, names={'#n': 'name', '#u': 'unit'}))
    return items, movement_id


def cost_of(value):
    """What the supplier charged for one unit. Optional: blank means not told. Two decimals at most."""
    if value is None or str(value).strip() == '':
        return None
    cost = num(value, 'Cost price')
    if cost < 0 or cost > Decimal('100000000') or cost.as_tuple().exponent < -2:
        raise bad('Cost price must be zero or more, with at most 2 decimals')
    return cost


# what only the owner may see: what the shop paid for its parts
COST_FIELDS = ('unit_cost', 'last_cost', 'last_cost_at', 'prev_cost')


def hide_cost(rows):
    """The mechanic types the supplier price but never reads it back."""
    one = isinstance(rows, dict)
    cleaned = [{k: ([{a: b for a, b in l.items() if a not in COST_FIELDS} for l in v] if k == 'lines' else v) for k, v in r.items() if k not in COST_FIELDS} for r in ([rows] if one else rows)]
    return cleaned[0] if one else cleaned


def set_cost(key, movement_id, who, body):
    """Owner: add or correct the supplier price on a goods received movement."""
    def build():
        mv = get('MV#' + str(movement_id), 'M')
        if not mv or mv['kind'] != 'RECEIPT':
            raise missing('Goods received entry not found')
        cost = cost_of((body or {}).get('unitCost'))
        if cost is None:
            raise bad('Enter the cost price')
        marker = mv['created_at'] + '#' + mv['id']
        ops = [update('MV#' + mv['id'], 'M', 'SET unit_cost = :c', {':c': cost}),
               update('MOVE', marker, 'SET unit_cost = :c', {':c': cost}),
               archive_audit(mv['product_id'], who, 'COST', {'movement': mv['id'], 'unit_cost': str(cost)})]
        labels = [None, None, None]
        product = get('PRODUCT', mv['product_id'])
        if product and (product.get('last_cost_at') or '') <= mv['created_at']:
            # the newest receipt decides the item's last cost
            ops.append(update('PRODUCT', product['id'], 'SET last_cost = :c, last_cost_at = :at', {':c': cost, ':at': mv['created_at']}))
            labels.append(None)
        return ops, labels, {'id': mv['id'], 'unit_cost': cost}
    result = command(key, 'movement-cost:' + movement_id, who, body, build)
    _cache['until'] = 0
    return result


def record_movement(key, who, body):
    def build():
        m = body or {}
        kind = m.get('kind')
        if kind == 'OPENING':
            raise bad('Opening stock is recorded during product registration')
        if kind not in KINDS:
            raise bad('Unsupported movement type')
        quantity = num(m.get('quantity'))
        counting = kind == 'COUNT'
        if quantity < 0 or (quantity == 0 and not counting) or quantity.as_tuple().exponent < -3:
            raise bad('Quantity must be positive, with at most 3 decimals' if not counting else 'The counted quantity must be zero or more, with at most 3 decimals')
        note = text(m.get('note'), 'Note', 500, False)
        extra = {}
        if kind == 'RECEIPT':
            extra = {'supplier': text(m.get('supplier'), 'Supplier', 100, False), 'reference': text(m.get('reference'), 'Supplier invoice or delivery no.', 60, False)}
            cost = cost_of(m.get('unitCost'))
            if cost is not None:
                extra['unit_cost'] = cost
        if counting and (m.get('jobId') or m.get('issueId') or m.get('receiverId')):
            raise bad('A count correction does not use a job or a receiver')
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
        if counting:
            # `quantity` is what was counted on the shelf; the ledger row stores the difference.
            if quantity == product['quantity']:
                raise bad('The count already matches the recorded stock')
            balance = quantity
            kind, quantity = ('COUNT_IN', balance - product['quantity']) if balance > product['quantity'] else ('COUNT_OUT', product['quantity'] - balance)
            note = note or 'Count correction'
            price = ZERO
        else:
            balance = product['quantity'] + (-quantity if kind in OUT_KINDS else quantity)
        if balance < 0:
            raise conflict('Insufficient stock for this issue')
        created = now()
        expr, values = 'SET quantity = :new', {':new': balance, ':old': product['quantity'], ':nf': False}
        if kind == 'RECEIPT' and extra.get('supplier') and not product.get('supplier'):
            expr += ', supplier = :sup'  # the first supplier named on a delivery becomes the item's usual supplier
            values[':sup'] = extra['supplier']
        if extra.get('unit_cost') is not None:
            # the last price paid, and the one before it so a rise or a drop can be shown to the owner
            expr += ', last_cost = :lc, last_cost_at = :lat'
            values.update({':lc': extra['unit_cost'], ':lat': created})
            if product.get('last_cost') is not None:
                expr += ', prev_cost = :pc'
                values[':pc'] = product['last_cost']
        ops.append(update('PRODUCT', product['id'], expr, values, condition='quantity = :old and archived = :nf'))
        labels.append(None)
        doc_no = None
        if kind in RUNNING and not note.startswith('Undo'):
            doc_no, counter = next_doc_no(kind)
            ops.append(counter)
            labels.append(None)
        rows, mid = movement_items(product, kind, quantity, price, job_id if on_job else None, issue_id, who, note,
                              receiver_id if (kind == 'STOCK_OUT' or counter_return) else None, receiver_name, created, extra, doc_no=doc_no)
        ops += rows
        labels += [None] * len(rows)
        result = {'id': mid, 'product_id': product['id'], 'kind': kind, 'quantity': quantity, 'unit_price': price,
                  'job_id': job_id if on_job else None, 'issue_id': issue_id, 'actor': who, 'note': note, 'created_at': created,
                  'receiver_id': receiver_id, 'sku': product['sku'], 'name': product['name'], 'unit': product['unit'],
                  'balance': balance, **{k: v for k, v in rows[0]['Put']['Item'].items() if k in ('doc_no', 'supplier', 'reference', 'unit_cost')}}
        return ops, labels, result
    result = command(key, 'movement', who, body, build)
    _cache['until'] = 0
    return result


def record_document(key, who, body):
    """One goods received note (a delivery) or one goods issue note (a counter handover) with several parts on it.
    Every line is a normal stock movement; they all carry the same running number and the ids of the whole note, so the
    printed note lists them together. Either every line is saved or none."""
    def build():
        m = body or {}
        kind = m.get('kind')
        if kind not in RUNNING:
            raise bad('A note is either a delivery (RECEIPT) or a counter handover (STOCK_OUT)')
        lines = m.get('lines')
        if not isinstance(lines, list) or not lines:
            raise bad('Add at least one part')
        if len(lines) > MAX_DOC_LINES:
            raise bad('One note holds up to %d parts. Save this one, then start the next' % MAX_DOC_LINES)
        note = text(m.get('note'), 'Note', 500, False)
        if note.startswith('Undo'):
            raise bad('Unsupported note')
        extra = {}
        if kind == 'RECEIPT':
            extra = {'supplier': text(m.get('supplier'), 'Supplier', 100, False), 'reference': text(m.get('reference'), 'Supplier invoice or delivery no.', 60, False)}
        receiver_id = m.get('receiverId') if kind == 'STOCK_OUT' else None
        receiver_name = active_person(receiver_id)['name'] if receiver_id else None
        doc_no, counter = next_doc_no(kind)
        ids = [str(uuid.uuid4()) for _ in lines]
        created, ops, seen, out = now(), [counter], set(), []
        for line, mid in zip(lines, ids):
            if not isinstance(line, dict):
                raise bad('Each line needs a part and a quantity')
            quantity = num(line.get('quantity'))
            if quantity <= 0 or quantity.as_tuple().exponent < -3:
                raise bad('Quantity must be positive, with at most 3 decimals')
            product = load_product(line.get('productId'))
            if product.get('archived'):
                raise conflict('%s is archived' % product['name'])
            if product['id'] in seen:
                raise bad('%s is on two lines. Put them on one line' % product['name'])
            seen.add(product['id'])
            if product['unit'] == 'UNIT' and quantity != quantity.to_integral_value():
                raise bad('%s is counted in whole units' % product['name'])
            balance = product['quantity'] + (-quantity if kind == 'STOCK_OUT' else quantity)
            if balance < 0:
                raise conflict('Only %s of %s in stock' % (product['quantity'].normalize(), product['name']))
            row_extra = dict(extra, doc_ids=ids)
            expr, values = 'SET quantity = :new', {':new': balance, ':old': product['quantity'], ':nf': False}
            if kind == 'RECEIPT':
                cost = cost_of(line.get('unitCost'))
                if cost is not None:
                    row_extra['unit_cost'] = cost
                    expr += ', last_cost = :lc, last_cost_at = :lat'
                    values.update({':lc': cost, ':lat': created})
                    if product.get('last_cost') is not None:
                        expr += ', prev_cost = :pc'
                        values[':pc'] = product['last_cost']
                if extra.get('supplier') and not product.get('supplier'):
                    expr += ', supplier = :sup'
                    values[':sup'] = extra['supplier']
            ops.append(update('PRODUCT', product['id'], expr, values, condition='quantity = :old and archived = :nf'))
            rows, _ = movement_items(product, kind, quantity, product['selling_price'], None, None, who, note,
                                     receiver_id, receiver_name, created, row_extra, doc_no=doc_no, movement_id=mid)
            ops += rows
            out.append({'id': mid, 'product_id': product['id'], 'name': product['name'], 'sku': product['sku'], 'quantity': quantity,
                        'balance': balance, 'unit': product['unit'], **({'unit_cost': row_extra['unit_cost']} if 'unit_cost' in row_extra else {})})
        result = {'doc_no': doc_no, 'kind': kind, 'id': ids[0], 'created_at': created, 'actor': who, 'lines': out,
                  **{k: v for k, v in extra.items() if v}}
        return ops, [None] * len(ops), result
    result = command(key, 'document', who, body, build)
    _cache['until'] = 0
    return result


# ---------- stock used on a workshop job ----------
def job_stock_ops(product, kind, quantity, job_id, who, note, price=None, ref=None):
    """Operations that take a part for a workshop job (ISSUE) or put it back (RETURN). The workshop adds them to its own
    transaction, so the job line and the stock always change together. Returns (operations, balance after)."""
    if kind not in ('ISSUE', 'RETURN'):
        raise bad('Unsupported movement type')
    if kind == 'ISSUE' and product.get('archived'):
        raise conflict('This part is archived. Restore it before using it on a job')
    if quantity <= 0 or quantity.as_tuple().exponent < -3:
        raise bad('Quantity must be positive, with at most 3 decimals')
    if product['unit'] == 'UNIT' and quantity != quantity.to_integral_value():
        raise bad('Sealed units require a whole number')
    balance = product['quantity'] + (-quantity if kind == 'ISSUE' else quantity)
    if balance < 0:
        raise conflict('Only %s of %s in stock' % (product['quantity'].normalize(), product['name']))
    created = now()
    # a returned part may belong to a product archived since; the quantity still has to come back
    cond = 'quantity = :old' + (' and archived = :nf' if kind == 'ISSUE' else '')
    values = {':new': balance, ':old': product['quantity']}
    if kind == 'ISSUE':
        values[':nf'] = False
    ops = [update('PRODUCT', product['id'], 'SET quantity = :new', values, condition=cond)]
    rows, _ = movement_items(product, kind, quantity, product['selling_price'] if price is None else price, job_id, None, who, note,
                             None, None, created, {'reference': ref} if ref else None)
    return ops + rows, balance


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


def analysis_rows(start, end, search='', category='', archived=True):
    """Every item with what happened to it between two moments. `added` in the ledger holds parts that came in AND parts that came
    back, so they are split here: came_in (receipts and opening stock), returned, taken (went out), adjusted (count corrections)."""
    first, last, a, b = _bounds(start, end)
    word, category = (search or '').strip().lower(), (category or '').strip().lower()
    chosen = []
    for p in sorted(query('PRODUCT'), key=lambda x: x['sku']):
        haystack = ' '.join(str(p.get(k) or '') for k in ('name', 'sku', 'brand', 'part_number', 'location')).lower()
        if (archived or not p.get('archived')) and word in haystack and (not category or p['category'].lower() == category):
            chosen.append(p)
    totals = {}
    for d in query('DAY', lt=last):
        t = totals.setdefault(d['product_id'], [ZERO, ZERO, ZERO, ZERO, ZERO])
        net = d['added'] - d['taken'] + d.get('adjusted', ZERO)
        if d['sk'][:10] < first:
            t[0] += net
        else:
            t[1] += d['added']
            t[2] += d['taken']
            t[3] += d.get('adjusted', ZERO)
            t[4] += d.get('returned', ZERO)
    rows = []
    for p in chosen:
        opening, added, taken, adjusted, returned = totals.get(p['id'], [ZERO] * 5)
        rows.append({'id': p['id'], 'sku': p['sku'], 'name': p['name'], 'brand': p['brand'], 'part_number': p.get('part_number'),
                     'category': p['category'], 'location': p.get('location', ''), 'supplier': p.get('supplier', ''), 'unit': p['unit'], 'archived': bool(p.get('archived')),
                     'available_now': p['quantity'], 'opening_quantity': opening, 'added_quantity': added,
                     'came_in_quantity': added - returned, 'returned_quantity': returned,
                     'taken_quantity': taken, 'adjusted_quantity': adjusted, 'closing_quantity': opening + added - taken + adjusted,
                     'selling_price': p['selling_price'], 'last_cost': p.get('last_cost'), 'prev_cost': p.get('prev_cost'),
                     'margin': p['selling_price'] - p['last_cost'] if p.get('last_cost') is not None else None})
    return rows, a, b


def analysis(start, end, search='', category='', archived=True, page=0):
    """Opening, added, taken and closing quantities per item. Days are Asia/Colombo days."""
    if page < 0 or page > 100000:
        raise bad('Invalid page')
    rows, a, b = analysis_rows(start, end, search, category, archived)
    return {'rows': rows[page * 100:page * 100 + 100], 'total': len(rows), 'page': page, 'pageSize': 100, 'from': a.isoformat(), 'until': b.isoformat(), 'asOf': now()}


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
        net = d['added'] - d['taken'] + d.get('adjusted', ZERO)
        # a part taken back (from a job or the counter) was not really used, so demand is what left minus what came back
        days.setdefault(d['product_id'], {})[day] = (net, max(d['taken'] - d.get('returned', ZERO), ZERO))
        totals[d['product_id']] = totals.get(d['product_id'], ZERO) + net
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
