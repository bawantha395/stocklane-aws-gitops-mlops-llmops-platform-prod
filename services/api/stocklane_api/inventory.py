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

from .core import PerShop, shop, tpk  # shop (tenant) plumbing

from .core import (COLOMBO, ApiError, bad, batch_get, check, command, conflict, delete, emails, get, missing, now, num,
                   public, put, query, unique, update, dumps)

ZERO = Decimal(0)
KINDS = {'OPENING', 'RECEIPT', 'ISSUE', 'RETURN', 'STOCK_OUT', 'COUNT'}
OUT_KINDS = {'ISSUE', 'STOCK_OUT'}
_cache = PerShop(until=0, value=None)


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


def with_supplier_names(rows):
    """A renamed supplier shows its current name on the parts it supplies (the part keeps the id; old notes keep the name of that day)."""
    if any(r.get('supplier_id') for r in rows):
        from . import suppliers
        known = suppliers.names()
        for r in rows:
            if r.get('supplier_id') in known:
                r['supplier'] = known[r['supplier_id']]
    return rows


def active_products():
    return with_supplier_names([product_view(p) for p in query('PRODUCT') if not p.get('archived')])


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
                                      Payload=json.dumps({'action': 'index', 'productId': product['id'], 'shop': shop()}).encode())
    except Exception as error:  # the 30-minute reconcile and the reindex action repair a missed call
        print('vision notification skipped:', type(error).__name__)


# ---------- reads ----------
def products(owner=True):
    rows = sorted(active_products(), key=lambda p: (p['created_at'], p['sku']), reverse=True)
    return priced(rows) if owner else hide_cost(rows)


def archived_products():
    return sorted(with_supplier_names([product_view(p) for p in query('PRODUCT') if p.get('archived')]), key=lambda p: p['sku'])


def catalogue():
    if time.monotonic() > _cache['until']:
        keys = ('id', 'sku', 'name', 'category', 'brand', 'grade', 'capacity', 'barcode', 'unit', 'selling_price',
                'reorder_level', 'image_id', 'part_number', 'location', 'archived', 'supplier', 'supplier_id')
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
    table().update_item(Key={'pk': tpk('PERSON'), 'sk': person_id}, UpdateExpression='SET active = :f',
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
RACK_TYPES = ('RACK', 'CUPBOARD', 'FLOOR')
MAX_AREAS, MAX_RACKS, MAX_LEVELS = 8, 100, 20


def new_id():
    return uuid.uuid4().hex[:10]


def shelf_label(rack, level=''):
    return rack + '-' + level if level else rack


def level_name(l):
    return l['name'] if isinstance(l, dict) else l


def shelf_names(racks):
    return [shelf_label(r['name'], level_name(l)) for r in racks for l in (r.get('levels') or [''])]


def shelf_index(racks):
    """label (lower case) -> (rack id, level id). A rack without levels is one shelf, with no level id."""
    out = {}
    for r in racks:
        for l in (r.get('levels') or [None]):
            out[shelf_label(r['name'], l['name'] if l else '').lower()] = (r.get('id'), l.get('id') if l else None)
    return out


def stores_row():
    return get('STORES', 'main') or {'racks': [], 'categories': [], 'areas': [], 'revision': 0}


def rack_public(r):
    """What older screens read: the level names. The ids, area and type ride along."""
    return {'id': r.get('id'), 'name': r['name'], 'area_id': r.get('area_id'), 'type': r.get('type') or 'RACK', 'levels': [level_name(l) for l in r.get('levels') or []],
            'level_ids': [l.get('id') if isinstance(l, dict) else None for l in r.get('levels') or []]}


def stores_view(row=None):
    row = row or stores_row()
    racks = row.get('racks') or []
    return {'racks': [rack_public(r) for r in racks], 'categories': row.get('categories') or [], 'areas': row.get('areas') or [], 'shelves': shelf_names(racks),
            'revision': int(row.get('revision') or 0)}


# A store room has exactly four walls. Their place is fixed (the person stands in the middle); only the names change.
WALLS = (('W', 'Left wall'), ('E', 'Right wall'), ('N', 'Top wall'), ('S', 'Bottom wall'))


def _clean_areas(raw, old):
    """Always the four walls, in the order W, E, N, S. A wall keeps its id and place; the owner can only rename it. A screen that sends names
    only (older ones) fills the walls in that order."""
    old_pos = {a.get('pos') or '': a for a in old or [] if a.get('pos')}
    for pos, default in WALLS:  # a shop that never saved its walls has the four standard ones
        old_pos.setdefault(pos, {'id': 'wall-' + pos.lower(), 'name': default, 'pos': pos})
    old_by_id = {a['id']: a for a in list(old_pos.values()) + list(old or [])}
    if raw is None:
        raw = []
    if not isinstance(raw, list) or len(raw) > len(WALLS):
        raise bad('A store room has 4 walls')
    named, free = {}, [p for p, _ in WALLS]
    for a in raw:
        if not isinstance(a, dict):
            raise bad('Check the walls')
        was = old_by_id.get(str(a.get('id') or ''))
        if a.get('id') and not was:
            raise missing('A wall is no longer there. Reload and try again.')
        pos = str(a.get('pos') or (was or {}).get('pos') or '').upper()
        if pos and pos not in free:
            raise bad('A wall is on the list twice')
        pos = pos or next(p for p in free)
        free.remove(pos)
        named[pos] = text(a.get('name'), 'Wall name', 40, True)
    out, names = [], set()
    for pos, default in WALLS:
        was = old_pos.get(pos)
        name = named.get(pos) or (was or {}).get('name') or default
        if name.lower() in names:
            raise bad('"%s" is on the list twice' % name)
        names.add(name.lower())
        out.append({'id': (was or {}).get('id') or 'wall-' + pos.lower(), 'name': name, 'pos': pos})
    return out


def clean_stores(body, old_racks=(), old_areas=()):
    """The racks and categories as the owner sent them. A rack or level keeps its id: by the id it came with, else by its name (so the older
    screens, which send names only, never lose ids). New ones get new ids. Returns racks, categories, areas."""
    areas = _clean_areas(body.get('areas'), old_areas)
    area_ids = {a['id'] for a in areas}
    racks, seen, rids = [], set(), set()
    raw = body.get('racks') or []
    if not isinstance(raw, list) or len(raw) > MAX_RACKS:
        raise bad('Up to %d racks' % MAX_RACKS)
    by_id = {r['id']: r for r in old_racks if r.get('id')}
    by_name = {r['name'].lower(): r for r in old_racks}
    for r in raw:
        if not isinstance(r, dict):
            raise bad('Check the racks')
        name = text(r.get('name'), 'Rack name', 40, True)
        if name.lower() in seen:
            raise bad('"%s" is in the list twice' % name)
        seen.add(name.lower())
        was = by_id.get(r.get('id')) if r.get('id') else by_name.get(name.lower())
        if r.get('id') and not was:
            raise missing('A rack is no longer there. Reload and try again.')
        rid = (was or {}).get('id') or new_id()
        if rid in rids:
            raise bad('"%s" is in the list twice' % name)
        rids.add(rid)
        rtype = str(r.get('type') or (was or {}).get('type') or 'RACK').upper()
        if rtype not in RACK_TYPES:
            raise bad('A rack is a rack, a cupboard or the floor')
        area = r['area_id'] if 'area_id' in r else (was or {}).get('area_id')
        if area and area not in area_ids:  # an area made in this same save is named by its name
            area = next((a['id'] for a in areas if a['name'].lower() == str(area).lower()), None)
            if not area:
                raise bad('Choose an area from the list')
        raw_levels = r.get('levels') or []
        if not isinstance(raw_levels, list) or len(raw_levels) > MAX_LEVELS:
            raise bad('Up to %d levels on a rack' % MAX_LEVELS)
        was_levels = {level_name(l).lower(): l for l in (was or {}).get('levels') or [] if isinstance(l, dict)}
        was_by_id = {l['id']: l for l in (was or {}).get('levels') or [] if isinstance(l, dict)}
        levels, lseen, lids = [], set(), set()
        for l in raw_levels:
            lname = text(level_name(l), 'Level', 12, True)
            if lname.lower() in lseen:
                raise bad('Level "%s" is on rack "%s" twice. Give each level its own name' % (lname, name))
            lseen.add(lname.lower())
            given = l.get('id') if isinstance(l, dict) else None
            old_l = was_by_id.get(given) if given else was_levels.get(lname.lower())
            if given and not old_l:
                raise missing('A level is no longer there. Reload and try again.')
            lid = (old_l or {}).get('id') or new_id()
            if lid in lids:
                raise bad('Level "%s" is on rack "%s" twice. Give each level its own name' % (lname, name))
            lids.add(lid)
            level = {'id': lid, 'name': lname}
            photo = photos_one(l.get('photo_id')) if isinstance(l, dict) and 'photo_id' in l else (old_l or {}).get('photo_id')
            if photo:
                level['photo_id'] = photo
            levels.append(level)
        racks.append({'id': rid, 'name': name, 'area_id': area or None, 'type': rtype, 'levels': levels})
    cats, cseen = [], set()
    raw = body.get('categories') if 'categories' in body else None
    if raw is None:
        cats = []
    else:
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
    return racks, cats, areas


def photos_one(value):
    from . import photos
    return photos.one(value, 'Shelf photo')


def _store_row(old, racks, cats, areas, who):
    row = {'pk': 'STORES', 'sk': 'main', 'racks': racks, 'categories': cats, 'areas': areas, 'revision': int(old.get('revision') or 0) + 1, 'updated_at': now(), 'updated_by': who}
    cond = {'ConditionExpression': 'revision = :r', 'ExpressionAttributeValues': {':r': old['revision']}} if old.get('pk') else {'ConditionExpression': 'attribute_not_exists(pk)'}
    return put(row, **cond), row


def _busy(old_labels_gone, cats_gone):
    used = active_products()
    busy_s = sorted({x for x in old_labels_gone if any((p.get('location') or '').lower() == x.lower() for p in used)})
    busy_c = sorted({x for x in cats_gone if any((p.get('category') or '').lower() == x.lower() for p in used)})
    return busy_s + busy_c


def stores_save(key, who, body):
    """Owner: the whole list of racks (with levels) and categories. A shelf or category that parts still use cannot be removed."""
    def build():
        old = stores_row()
        b = body or {}
        if 'racks' not in b:  # the categories screen sends no racks: they stay as they are
            b = dict(b, racks=old.get('racks') or [])
        racks, cats, areas = clean_stores(b, old.get('racks') or [], old.get('areas') or [])
        want = {x.lower() for x in shelf_names(racks)}
        want_c = {x.lower() for x in cats}
        gone = [x for x in shelf_names(old.get('racks') or []) if x.lower() not in want]
        gone_c = [x for x in old.get('categories') or [] if x.lower() not in want_c]
        if gone or gone_c:
            busy = _busy(gone, gone_c)
            if busy:
                raise conflict('Parts still use ' + ', '.join(busy) + '. Move those parts first, then remove it')
        op, row = _store_row(old, racks, cats, areas, who)
        return [op], [None], stores_view(row)
    return command(key, 'stores', who, body, build)


def stores_add(key, who, body):
    """Owner: add one rack, one level on a rack, or one category from the item form, without touching the rest of the list."""
    def build():
        b = body or {}
        old = stores_row()
        racks = [dict(r, levels=[dict(l) for l in r.get('levels') or []]) for r in old.get('racks') or []]
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
            rack['levels'].append({'name': text(b.get('level'), 'Level', 12, True)})
        else:
            raise bad('Add a rack, a level or a category')
        racks, cats, areas = clean_stores({'racks': racks, 'categories': cats}, old.get('racks') or [], old.get('areas') or [])
        op, row = _store_row(old, racks, cats, areas, who)
        return [op], [None], stores_view(row)
    return command(key, 'stores-add', who, body, build)


def _move_parts(moves, field):
    """Parts (archived ones too, so a restored part still points at a real shelf) follow a renamed shelf or category. Batches that are safe to repeat."""
    from .core import Retry, transact
    moved, todo = 0, [p for p in query('PRODUCT') if str(p.get(field) or '').lower() in moves]
    for i in range(0, len(todo), 50):
        ops = [update('PRODUCT', p['sk'], 'SET #f = :n', {':n': moves[str(p[field]).lower()], ':o': p[field]}, {'#f': field}, '#f = :o') for p in todo[i:i + 50]]
        try:
            transact(ops, [None] * len(ops))
        except Retry:  # a part was edited meanwhile: move this batch one by one, skipping the ones that changed
            for op in ops:
                try:
                    transact([op], [None])
                except Retry:
                    continue
        moved += len(ops)
    _cache['until'] = 0
    return moved


def stores_rename(who, body):
    """Owner: give a rack, one level of a rack, or a category a new name; every part that used the old name follows it.

    Three small steps, each safe to repeat, so a rename that is cut off half way is finished by pressing Save again:
    the new name joins the list, the parts move over (in batches), the old name leaves the list. The ids never change.
    """
    from .core import transact
    b = body or {}
    kind = b.get('kind')
    row = stores_row()
    racks = [dict(r, levels=[dict(l) for l in r.get('levels') or []]) for r in row.get('racks') or []]
    cats = list(row.get('categories') or [])
    moves, field = {}, 'location'  # old value (lower case) -> new value
    if kind == 'category':
        old, new = text(b.get('from'), 'Category', 80, True), text(b.get('to'), 'New name', 80, True)
        if not any(c.lower() == old.lower() for c in cats):
            raise missing('Category not found')
        if old.lower() != new.lower() and any(c.lower() == new.lower() for c in cats):
            raise conflict('"%s" is already on the list' % new)
        moves, field = {old.lower(): new}, 'category'
        cats = [new if c.lower() == old.lower() else c for c in cats]
    elif kind in ('rack', 'level'):
        rack = next((r for r in racks if r['name'].lower() == str(b.get('rack') or b.get('from') or '').strip().lower() or (b.get('id') and r.get('id') == b.get('id'))), None)
        if not rack:
            raise missing('Rack not found')
        before = shelf_names([rack])
        if kind == 'rack':
            new = text(b.get('to'), 'New name', 40, True)
            if new.lower() != rack['name'].lower() and any(r['name'].lower() == new.lower() for r in racks):
                raise conflict('"%s" is already on the list' % new)
            rack['name'] = new
        else:
            old, new = text(b.get('from'), 'Level', 12, True), text(b.get('to'), 'New name', 12, True)
            if not any(l['name'].lower() == old.lower() for l in rack['levels']):
                raise missing('Level not found')
            if old.lower() != new.lower() and any(l['name'].lower() == new.lower() for l in rack['levels']):
                raise conflict('"%s" is already on %s' % (new, rack['name']))
            rack['levels'] = [dict(l, name=new) if l['name'].lower() == old.lower() else l for l in rack['levels']]
        moves = {a.lower(): z for a, z in zip(before, shelf_names([rack])) if a != z}
    else:
        raise bad('Rename a rack, a level or a category')
    racks, cats, areas = clean_stores({'racks': racks, 'categories': cats}, row.get('racks') or [], row.get('areas') or [])
    op, new_row = _store_row(row, racks, cats, areas, who)
    transact([op], ['Someone changed the lists just now. Reload and try again.'])
    moved = _move_parts(moves, field)
    return dict(stores_view(new_row), moved=moved)


def stores_standard(key, who, names):
    """Owner: add the standard part categories that are not on the list yet."""
    def build():
        old = stores_row()
        cats = list(old.get('categories') or [])
        have = {c.lower() for c in cats}
        cats += [n for n in names if n.lower() not in have]
        racks, cats, areas = clean_stores({'racks': old.get('racks') or [], 'categories': cats}, old.get('racks') or [], old.get('areas') or [])
        op, row = _store_row(old, racks, cats, areas, who)
        return [op], [None], stores_view(row)
    return command(key, 'stores-standard', who, {'names': names}, build)


# ---------- the store room layout (areas, racks, levels with stable ids) ----------
def shelf_of(location):
    """(rack id, level id) for a shelf label, or (None, None) for free text / no shelf."""
    if not location:
        return None, None
    return shelf_index(stores_row().get('racks') or []).get(str(location).lower(), (None, None))


def layout_view(row=None):
    """Everything the store-room screens need: the layout, how many parts sit on each shelf, and how many are not shelved."""
    row = row or stores_row()
    racks = row.get('racks') or []
    index = shelf_index(racks)
    counts, loose = {}, 0
    for p in active_products():
        rid, lid = p.get('rack_id'), p.get('level_id')
        if not rid:
            rid, lid = index.get((p.get('location') or '').lower(), (None, None))
        if not rid:
            loose += 1
            continue
        c = counts.setdefault(rid, {})
        c[lid or ''] = c.get(lid or '', 0) + 1
    counted = {}
    for c in query('SHELFCOUNT'):
        counted.setdefault(c['rack_id'], {})[c.get('level_id') or ''] = {'at': c['at'], 'by': c.get('by')}
    return {'areas': _clean_areas(None, row.get('areas') or []), 'categories': row.get('categories') or [], 'revision': int(row.get('revision') or 0), 'not_shelved': loose, 'counts': counts, 'counted': counted,
            'racks': [{'id': r['id'], 'name': r['name'], 'area_id': r.get('area_id'), 'type': r.get('type') or 'RACK',
                       'levels': [{'id': l['id'], 'name': l['name'], **({'photo_id': l['photo_id']} if l.get('photo_id') else {})} for l in r.get('levels') or []]} for r in racks]}


def shelf_parts(rack, level=''):
    """The parts on one rack (all its levels), on one level, or not shelved at all (rack 'none'). A part counts by its ids, else by its location text.
    Archived parts are left out. Only what the Shelf page shows: no cost."""
    row = stores_row()
    racks = row.get('racks') or []
    index = shelf_index(racks)
    rack, level = str(rack or ''), str(level or '')
    if rack != 'none':
        hit = next((r for r in racks if r.get('id') == rack), None)
        if not hit:
            raise missing('That rack is no longer there. Reload the store room.')
        if level and level != 'none' and not any(l.get('id') == level for l in hit.get('levels') or []):
            raise missing('That level is no longer there. Reload the store room.')
    out = []
    for p in active_products():
        rid, lid = p.get('rack_id'), p.get('level_id')
        if not rid:
            rid, lid = index.get((p.get('location') or '').lower(), (None, None))
        if rack == 'none':
            ok = not rid
        else:
            ok = rid == rack and (not level or (lid or 'none') == level)
        if ok:
            out.append({k: p.get(k) for k in ('id', 'sku', 'name', 'brand', 'part_number', 'unit', 'quantity', 'reorder_level', 'location', 'image_id')} | {'level_id': lid})
    out.sort(key=lambda r: (r.get('name') or '').lower())
    return {'rack_id': None if rack == 'none' else rack, 'level_id': level or None, 'parts': out}


MAX_MOVE = 15  # one transaction holds 100 writes and each part needs 5


def shelf_move(key, who, body):
    """Move parts to another shelf: one part or many, in one save (all or none). Each part keeps its stock; its shelf text, the rack and level ids
    the map reads, and a history row 'Moved Rack 1-A to Rack 2-C' change together. A part already on that shelf is left alone."""
    def build():
        b = body or {}
        ids = b.get('productIds')
        if not isinstance(ids, list) or not ids:
            raise bad('Choose the parts to move')
        if len(ids) > MAX_MOVE or len(set(map(str, ids))) != len(ids):
            raise bad('Move up to %d different parts at a time' % MAX_MOVE)
        racks = stores_row().get('racks') or []
        rack = next((r for r in racks if r.get('id') == str(b.get('rackId') or '')), None)
        if not rack:
            raise missing('That rack is no longer there. Reload the store room.')
        level = None
        if rack.get('levels'):
            level = next((l for l in rack['levels'] if l.get('id') == str(b.get('levelId') or '')), None)
            if not level:
                raise bad('Choose the level of %s' % rack['name'])
        target = shelf_label(rack['name'], level['name'] if level else '')
        created, ops, out = now(), [], []
        for pid in ids:
            product = load_product(pid)
            if product.get('archived'):
                raise conflict('%s is archived' % product['name'])
            old = product.get('location') or ''
            if old == target:
                continue
            expr = 'SET #loc = :loc, rack_id = :rid' + (', level_id = :lid' if level else ' REMOVE level_id')
            values = {':loc': target, ':rid': rack['id']}
            if level:
                values[':lid'] = level['id']
            ops.append(update('PRODUCT', product['id'], expr, values, names={'#loc': 'location'}, condition='attribute_exists(pk)'))
            rows, _ = movement_items(product, 'SHELF_MOVE', ZERO, product['selling_price'], None, None, who, 'Moved %s to %s' % (old or 'no shelf', target), None, None, created,
                                     {'from_shelf': old, 'to_shelf': target})
            ops += rows
            out.append({'product_id': product['id'], 'name': product['name'], 'from': old, 'to': target})
        if not ops:
            raise conflict('They are already on %s' % target)
        return ops, [None] * len(ops), {'shelf': target, 'rack_id': rack['id'], 'level_id': level['id'] if level else None, 'moved': out}
    result = command(key, 'shelf-move', who, body, build)
    _cache['until'] = 0
    return result


def shelf_count(key, who, body):
    """A shelf count: the person counts what is on one shelf (or rack) and saves all the differences at once. Each part that differs gets a COUNT
    row (found extra / found missing); parts that match are left alone. The shelf remembers when it was last counted, even if nothing differed."""
    def build():
        b = body or {}
        racks = stores_row().get('racks') or []
        rack = next((r for r in racks if r.get('id') == str(b.get('rackId') or '')), None)
        if not rack:
            raise missing('That rack is no longer there. Reload the store room.')
        level_id = str(b.get('levelId') or '')
        if level_id and not any(l.get('id') == level_id for l in rack.get('levels') or []):
            raise missing('That level is no longer there. Reload the store room.')
        lines = b.get('counts')
        if not isinstance(lines, list) or not lines or len(lines) > MAX_MOVE:
            raise bad('Count up to %d parts at a time' % MAX_MOVE)
        if len({str(l.get('productId')) for l in lines if isinstance(l, dict)}) != len(lines):
            raise bad('Each part once')
        on_shelf = {p['id'] for p in shelf_parts(rack['id'], level_id)['parts']}
        created, ops, out = now(), [], []
        for line in lines:
            product = load_product(str(line.get('productId')))
            if product['id'] not in on_shelf:
                raise conflict('%s is not on this shelf any more. Reload it.' % product['name'])
            counted = num(line.get('counted'), 'Counted')
            if counted < 0:
                raise bad('Counted cannot be below zero')
            if counted == product['quantity']:
                continue
            kind, diff = ('COUNT_IN', counted - product['quantity']) if counted > product['quantity'] else ('COUNT_OUT', product['quantity'] - counted)
            ops.append(update('PRODUCT', product['id'], 'SET quantity = :new', {':new': counted, ':old': product['quantity'], ':nf': False}, condition='quantity = :old and archived = :nf'))
            rows, _ = movement_items(product, kind, diff, ZERO, None, None, who, 'Shelf count', None, None, created)
            ops += rows
            out.append({'product_id': product['id'], 'name': product['name'], 'was': product['quantity'], 'now': counted})
        ops.append(put({'pk': 'SHELFCOUNT', 'sk': rack['id'] + '#' + level_id, 'rack_id': rack['id'], 'level_id': level_id, 'at': created, 'by': who}))
        return ops, [None] * len(ops), {'changed': out, 'at': created}
    result = command(key, 'shelf-count', who, body, build)
    _cache['until'] = 0
    return result


def layout_save(key, who, body):
    """Owner: areas, racks and levels in the order shown. Ids keep a shelf the same shelf when it is renamed or moved to another area. A shelf
    that parts still sit on cannot be removed. Renamed shelves carry their parts' location text along (same 3 safe steps as a rename)."""
    from .core import transact
    b = body or {}
    old = stores_row()
    if int(b.get('revision') if b.get('revision') is not None else old.get('revision') or 0) != int(old.get('revision') or 0):
        raise conflict('Someone changed the store room just now. Reload and try again.')
    racks, _, areas = clean_stores({'racks': b.get('racks') or [], 'areas': b.get('areas') or [], 'categories': old.get('categories') or []}, old.get('racks') or [], old.get('areas') or [])
    old_index = {v: k for k, v in shelf_index(old.get('racks') or []).items()}
    new_index = {v: k for k, v in shelf_index(racks).items()}
    labels = {}  # (rack id, level id) -> the label, as spelled
    for r in old.get('racks') or []:
        for l in (r.get('levels') or [None]):
            labels[(r['id'], l['id'] if l else None)] = ('old', shelf_label(r['name'], l['name'] if l else ''))
    gone = [labels[k][1] for k in old_index if k not in new_index]
    if gone:
        busy = _busy(gone, [])
        if busy:
            raise conflict('Parts still sit on ' + ', '.join(busy) + '. Move those parts first, then remove it')
    new_labels = {}
    for r in racks:
        for l in (r.get('levels') or [None]):
            new_labels[(r['id'], l['id'] if l else None)] = shelf_label(r['name'], l['name'] if l else '')
    moves = {labels[k][1].lower(): new_labels[k] for k in new_labels if k in labels and labels[k][1] != new_labels[k]}
    op, row = _store_row(old, racks, old.get('categories') or [], areas, who)
    transact([op], ['Someone changed the store room just now. Reload and try again.'])
    moved = _move_parts(moves, 'location') if moves else 0
    return dict(layout_view(row), moved=moved)


def quick_start(key, who, body):
    """Owner, a shop with no racks yet: the 4 walls with racks 1 to 12 (three on each wall), each with levels A, B and C, so the shelves are
    named 1-A, 1-B, 1-C, 2-A and so on. The owner then renames, trims and rearranges."""
    def build():
        old = stores_row()
        if old.get('racks'):
            raise conflict('This shop already has racks. Change them in the list.')
        areas = _clean_areas(None, old.get('areas') or [])
        racks = [{'name': str(n + 1), 'area_id': areas[n // 3]['id'], 'type': 'RACK', 'levels': ['A', 'B', 'C']} for n in range(12)]
        racks, cats, areas = clean_stores({'racks': racks, 'areas': areas, 'categories': old.get('categories') or []}, (), areas)
        op, row = _store_row(old, racks, cats, areas, who)
        return [op], [None], layout_view(row)
    return command(key, 'stores-quick-start', who, body, build)


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
def _new_product(p, who):
    """The writes that make one catalogue part (and its opening count), and what to show for it. Used by one-at-a-time and by CSV import."""
    part = text(p.get('partNumber'), 'Manufacturer part number')
    sku = text(p.get('sku'), 'SKU').upper()
    name, category, brand = text(p.get('name'), 'Name'), text(p.get('category'), 'Category', 80), text(p.get('brand'), 'Brand', 100)
    grade, capacity = text(p.get('grade'), 'Grade', 80, False), text(p.get('capacity'), 'Capacity', 60, False)
    location = text(p.get('location'), 'Location', 180, False)
    location, category = listed(location, category)
    rack_id, level_id = shelf_of(location)
    unit = p.get('unit')
    if unit not in ('UNIT', 'LITRE'):
        raise bad('Unit must be UNIT or LITRE')
    price, reorder, opening = non_negative(p.get('sellingPrice'), 'Price'), non_negative(p.get('reorderLevel'), 'Reorder level'), non_negative(p.get('openingQuantity'), 'Opening quantity')
    if unit == 'UNIT' and opening != opening.to_integral_value():
        raise bad('Sealed units require a whole number')
    barcode = (p.get('barcode') or '').strip() or None
    cost = cost_of(p.get('cost')) if p.get('cost') not in (None, '', 0, '0') else None  # optional: what the supplier charged for one unit
    product_id = str(uuid.uuid4())
    created = now()
    item = {'pk': 'PRODUCT', 'sk': product_id, 'id': product_id, 'sku': sku, 'name': name, 'category': category,
            'brand': brand, 'grade': grade, 'capacity': capacity, 'unit': unit, 'quantity': opening,
            'selling_price': price, 'reorder_level': reorder, 'created_at': created, 'archived': False,
            'manufacturer_key': brand.upper(), 'part_number': part_key(part), 'location': location,
            **({'rack_id': rack_id, **({'level_id': level_id} if level_id else {})} if rack_id else {})}
    from . import suppliers
    sid, sname = suppliers.resolve(p.get('supplierId'), p.get('supplier'))
    if sname:
        item['supplier'] = sname
    if sid:
        item['supplier_id'] = sid
    if barcode:
        item['barcode'] = barcode
    if cost is not None:
        item['last_cost'], item['last_cost_at'] = cost, created
    if p.get('imageId'):
        item['image_id'] = str(p['imageId'])
    ops, labels = [put(item), unique('sku', sku), unique('part', item['manufacturer_key'] + '|' + item['part_number'])], \
        [None, 'SKU ' + sku + ' already exists', 'This manufacturer part number already exists']
    if barcode:
        ops.append(unique('barcode', barcode))
        labels.append('This barcode already belongs to another item')
    result = product_view(item)
    if opening > 0:
        extra, _ = movement_items(item, 'OPENING', opening, price, None, None, who, 'Approved initial physical count', None, None, created, extra={'unit_cost': cost} if cost is not None else None)
        ops += extra
        labels += [None] * len(extra)
        result['opening_movement'] = True
    return ops, labels, result


MAX_IMPORT = 10      # one transaction holds 100 writes; a new part with its opening count needs about 9
MAX_IMPORT_CHECK = 300


def import_products(key, who, body):
    """CSV import of the catalogue. dryRun checks every row and writes nothing: each row's problem is named with its row number, duplicates inside
    the file and against the catalogue included. A real import takes up to 10 rows, all or none; the screen sends them in turns."""
    b = body or {}
    rows = b.get('rows')
    if not isinstance(rows, list) or not rows:
        raise bad('The file has no rows')
    if b.get('dryRun'):
        if len(rows) > MAX_IMPORT_CHECK:
            raise bad('Up to %d rows at a time' % MAX_IMPORT_CHECK)
        have_sku, have_part, have_bar = set(), set(), set()
        for x in query('PRODUCT'):
            have_sku.add((x.get('sku') or '').upper())
            have_part.add((x.get('manufacturer_key') or '') + '|' + (x.get('part_number') or ''))
            if x.get('barcode'):
                have_bar.add(x['barcode'])
        errors, good = [], 0
        for n, r in enumerate(rows, start=1):
            try:
                r = dict(r) if isinstance(r, dict) else {}
                r['sku'] = (r.get('sku') or '').strip() or 'ITEM-CHECK'
                r['unit'] = r.get('unit') or 'UNIT'
                _, _, view = _new_product(r, who)
                part = (view.get('manufacturer_key') or '') + '|' + (view.get('part_number') or '')
                if r['sku'].upper() in have_sku and r['sku'] != 'ITEM-CHECK':
                    raise bad('SKU %s already exists' % r['sku'].upper())
                if part in have_part:
                    raise bad('This manufacturer part number already exists')
                if view.get('barcode') and view['barcode'] in have_bar:
                    raise bad('This barcode already belongs to another item')
                if r['sku'] != 'ITEM-CHECK':
                    have_sku.add(r['sku'].upper())
                have_part.add(part)
                if view.get('barcode'):
                    have_bar.add(view['barcode'])
                good += 1
            except ApiError as e:
                errors.append({'row': n, 'error': e.message})
        return {'rows': len(rows), 'ok': good, 'errors': errors}

    def build():
        if len(rows) > MAX_IMPORT:
            raise bad('Import up to %d parts at a time' % MAX_IMPORT)
        ops, labels, made = [], [], []
        for n, r in enumerate(rows, start=1):
            r = dict(r) if isinstance(r, dict) else {}
            r['sku'] = (r.get('sku') or '').strip() or 'ITEM-' + uuid.uuid4().hex[:8].upper()
            r['unit'] = r.get('unit') or 'UNIT'
            try:
                o, l, view = _new_product(r, who)
            except ApiError as e:
                raise bad('Row %d: %s' % (n, e.message)) from None
            ops += o
            labels += [x if x is None else 'Row %d: %s' % (n, x) for x in l]
            made.append({'id': view['id'], 'sku': view['sku'], 'name': view['name']})
        return ops, labels, {'created': made}
    result = command(key, 'import-products', who, body, build)
    _cache['until'] = 0
    return result


def create_product(key, who, body):
    def build():
        return _new_product(body or {}, who)

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
        updated.pop('rack_id', None), updated.pop('level_id', None)
        rid, lid = shelf_of(new_location)
        if rid:
            updated['rack_id'] = rid
            if lid:
                updated['level_id'] = lid
        if 'supplier' in p or 'supplierId' in p:
            from . import suppliers
            sid, sname = suppliers.resolve(p.get('supplierId'), p.get('supplier'), keep=item.get('supplier_id'))
            updated['supplier'] = sname
            if sid:
                updated['supplier_id'] = sid
            else:
                updated.pop('supplier_id', None)
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
DOCS = {'RECEIPT': 'GRN', 'STOCK_OUT': 'GIN', 'ISSUE': 'GIN', 'RETURN': 'RTN', 'SUPPLIER_RETURN': 'SRN', 'ORDER': 'PO'}  # goods received note, goods issue note
RUNNING = ('RECEIPT', 'STOCK_OUT', 'SUPPLIER_RETURN')  # these notes are numbered in a running series (GRN-0001, GIN-0001); a part put on a job is named by the job
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
    adjusted = quantity if kind == 'COUNT_IN' else -quantity if kind in ('COUNT_OUT', 'SUPPLIER_RETURN') else ZERO
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
COST_FIELDS = ('unit_cost', 'last_cost', 'last_cost_at', 'prev_cost', 'markup_pct', 'markup_used', 'suggested_price', 'margin_pct')


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
        event = put({'pk': 'COSTEV', 'sk': now() + '#' + mv['id'], 'at': now(), 'by': who, 'name': mv.get('name', ''), 'old': str(mv['unit_cost']) if mv.get('unit_cost') is not None else '', 'new': str(cost)})
        ops = [event, update('MV#' + mv['id'], 'M', 'SET unit_cost = :c', {':c': cost}),
               update('MOVE', marker, 'SET unit_cost = :c', {':c': cost}),
               archive_audit(mv['product_id'], who, 'COST', {'movement': mv['id'], 'unit_cost': str(cost)})]
        labels = [None, None, None, None]
        product = get('PRODUCT', mv['product_id'])
        if product and (product.get('last_cost_at') or '') <= mv['created_at']:
            # the newest receipt decides the item's last cost
            ops.append(update('PRODUCT', product['id'], 'SET last_cost = :c, last_cost_at = :at', {':c': cost, ':at': mv['created_at']}))
            labels.append(None)
        return ops, labels, {'id': mv['id'], 'unit_cost': cost}
    result = command(key, 'movement-cost:' + movement_id, who, body, build)
    _cache['until'] = 0
    return result


TERMS = ('PAID', 'CREDIT')


def delivery_terms(m, supplier_id):
    """How a delivery is paid: now (the default, nothing is owed) or on credit (the supplier is owed until it is paid). A credit
    delivery needs a supplier from the list, and carries that supplier's credit days of the day."""
    terms = str(m.get('terms') or 'PAID').upper()
    if terms not in TERMS:
        raise bad('A delivery is either paid now or on credit')
    if terms == 'PAID':
        return {}
    if not supplier_id:
        raise bad('Choose the supplier from the list for a delivery on credit')
    from . import suppliers
    return {'terms': 'CREDIT', 'due_days': int(suppliers.one(supplier_id).get('credit_days') or 0)}


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
            from . import suppliers
            sid, sname = suppliers.resolve(m.get('supplierId'), m.get('supplier'))
            extra = {'supplier': sname, 'supplier_id': sid, 'reference': text(m.get('reference'), 'Supplier invoice or delivery no.', 60, False), **delivery_terms(m, sid)}
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
            if extra.get('supplier_id'):
                expr += ', supplier_id = :sid'
                values[':sid'] = extra['supplier_id']
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
                  'balance': balance, **{k: v for k, v in rows[0]['Put']['Item'].items() if k in ('doc_no', 'supplier', 'supplier_id', 'reference', 'unit_cost', 'terms')}}
        return ops, labels, result
    result = command(key, 'movement', who, body, build)
    _cache['until'] = 0
    if result.get('kind') == 'RECEIPT' and result.get('supplier_id'):
        _orders_follow(result['supplier_id'], [(result['product_id'], result['quantity'])], result.get('doc_no') or result['id'])
    return result


def _orders_follow(supplier_id, lines, token):
    """A delivery from a supplier closes the matching lines of its open orders. Best effort: the delivery is already saved, so a failure here only
    leaves an order showing as waiting until someone marks it received."""
    try:
        from . import orders
        orders.on_receipt(supplier_id, lines, token)
    except Exception:  # noqa: BLE001
        import traceback
        traceback.print_exc()


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
            from . import suppliers
            sid, sname = suppliers.resolve(m.get('supplierId'), m.get('supplier'))
            extra = {'supplier': sname, 'supplier_id': sid, 'reference': text(m.get('reference'), 'Supplier invoice or delivery no.', 60, False), **delivery_terms(m, sid)}
        elif kind == 'SUPPLIER_RETURN':
            from . import suppliers
            if not m.get('supplierId'):
                raise bad('Choose the supplier these parts go back to')
            sid, sname = suppliers.resolve(m.get('supplierId'), '', keep=str(m.get('supplierId')))
            reason = text(m.get('reason'), 'Reason', 200, True)
            extra = {'supplier': sname, 'supplier_id': sid, 'reference': text(m.get('reference'), 'Supplier credit note no.', 60, False), 'reason': reason}
            note = ('Returned to supplier: ' + reason)[:500]
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
            balance = product['quantity'] + (-quantity if kind in ('STOCK_OUT', 'SUPPLIER_RETURN') else quantity)
            if balance < 0:
                raise conflict('Only %s of %s in stock' % (product['quantity'].normalize(), product['name']))
            row_extra = dict(extra, doc_ids=ids)
            expr, values, names = 'SET quantity = :new', {':new': balance, ':old': product['quantity'], ':nf': False}, None
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
                    if extra.get('supplier_id'):
                        expr += ', supplier_id = :sid'
                        values[':sid'] = extra['supplier_id']
                # the shelf it was put on (batch screen): written the way the owner's list spells it, with the ids the map uses
                shelf = text(line.get('location'), 'Shelf', 180, False)
                if shelf and shelf != (product.get('location') or ''):
                    shelf, _ = listed(shelf, None, keep=(product.get('location') or '',))
                    rid, lid = shelf_of(shelf)
                    expr += ', #loc = :loc' + (', rack_id = :rid' if rid else '') + (', level_id = :lid' if lid else '')
                    values[':loc'] = shelf
                    names = {'#loc': 'location'}
                    if rid:
                        values[':rid'] = rid
                    if lid:
                        values[':lid'] = lid
                    gone = ([] if rid else ['rack_id']) + ([] if lid else ['level_id'])
                    if gone:
                        expr += ' REMOVE ' + ', '.join(gone)
            if kind == 'SUPPLIER_RETURN':
                # what the shop paid for them: the price on the line, else the last price paid; it lowers what is owed to the supplier
                cost = cost_of(line.get('unitCost'))
                cost = cost if cost is not None else product.get('last_cost')
                if cost is not None:
                    row_extra['unit_cost'] = cost
            ops.append(update('PRODUCT', product['id'], expr, values, names=names, condition='quantity = :old and archived = :nf'))
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
    if result.get('kind') == 'RECEIPT' and result.get('supplier_id'):
        _orders_follow(result['supplier_id'], [(l['product_id'], l['quantity']) for l in result['lines']], result['doc_no'])
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


# ---------- price and markup ----------
PRICE_STEP = Decimal(5)  # suggested prices are rounded up to the next 5 rupees
MAX_PRICE = Decimal(10_000_000)
PRICE_BATCH = 25  # each change is two writes; one transaction holds 100


def suggested(cost, markup):
    """Cost plus the markup (30 means +30%), rounded up to the next 5 rupees. None when the cost or the markup is not known."""
    if cost is None or not markup or markup <= 0:
        return None
    raw = Decimal(cost) * (1 + Decimal(markup) / 100)
    return ((raw / PRICE_STEP).to_integral_value(rounding='ROUND_CEILING') * PRICE_STEP).quantize(Decimal('0.01'))


def margin_pct(price, cost):
    """What share of the selling price is profit: (price - cost) / price. None without both."""
    if cost is None or not price or price <= 0:
        return None
    return ((Decimal(price) - Decimal(cost)) / Decimal(price) * 100).quantize(Decimal('0.1'))


def priced(rows, default=None):
    """Adds markup, suggested price and margin to part rows. Only for people who may see cost."""
    if default is None:
        from . import workshop
        default = workshop.business().get('default_markup_pct') or ZERO
    out = []
    for r in rows:
        used = r.get('markup_pct') if r.get('markup_pct') is not None else default
        out.append(dict(r, markup_used=used if used else None, suggested_price=suggested(r.get('last_cost'), used), margin_pct=margin_pct(r.get('selling_price'), r.get('last_cost'))))
    return out


def _price(value):
    price = non_negative(value, 'Price')
    if price > MAX_PRICE or price.as_tuple().exponent < -2:
        raise bad('The price must be 10,000,000 or less, with at most 2 decimals')
    return price


def _log(item, old, new, who, at):
    return put({'pk': 'PRICELOG', 'sk': at + '#' + uuid.uuid4().hex[:8], 'product_id': item['id'], 'sku': item['sku'], 'name': item['name'], 'old': old, 'new': new, 'by': who, 'at': at})


def set_price(key, product_id, who, body):
    """Change a part's selling price and/or its own markup. Jobs and bills already made keep the price they were made at."""
    def build():
        item, b = load_product(product_id), body or {}
        new, at = dict(item), now()
        ops, labels = [], []
        if 'price' in b:
            price, old = _price(b['price']), item['selling_price']
            if price == old and 'markupPct' not in b:
                raise bad('The price is already %s' % format(old, ',.2f'))
            new['selling_price'] = price
        if 'markupPct' in b:
            from . import workshop
            if b['markupPct'] in (None, ''):
                new.pop('markup_pct', None)
            else:
                new['markup_pct'] = workshop.markup_pct(b['markupPct'], 'Markup')
        if 'price' not in b and 'markupPct' not in b:
            raise bad('Send a price or a markup')
        ops.append(put(new, ConditionExpression='selling_price = :o', ExpressionAttributeValues={':o': item['selling_price']}))
        labels.append(None)
        if new['selling_price'] != item['selling_price']:
            ops.append(_log(item, item['selling_price'], new['selling_price'], who, at))
            labels.append(None)
        return ops, labels, priced([product_view(new)])[0]
    result = command(key, 'set-price:' + product_id, who, body, build)
    announce(result)
    _cache['until'] = 0
    return result


def price_review():
    """Parts whose selling price differs from cost plus markup, lowest margin first. Parts with no known cost or no markup are not listed."""
    rows = [r for r in priced(active_products()) if r['suggested_price'] is not None and r['suggested_price'] != r['selling_price']]
    for r in rows:
        r['below'] = r['selling_price'] < r['suggested_price']
    keys = ('id', 'sku', 'name', 'part_number', 'unit', 'quantity', 'last_cost', 'selling_price', 'suggested_price', 'markup_used', 'margin_pct', 'below')
    rows = sorted(({k: r.get(k) for k in keys} for r in rows), key=lambda r: (r['margin_pct'] is None, r['margin_pct'] if r['margin_pct'] is not None else 0, r['sku']))
    return {'items': rows, 'below': sum(1 for r in rows if r['below'])}


def apply_prices(key, who, body):
    """Set several prices at once (the review screen). All or none; a part changed by someone else meanwhile makes the whole batch retry or stop."""
    def build():
        items = (body or {}).get('items')
        if not isinstance(items, list) or not items:
            raise bad('Choose the prices to set')
        if len(items) > PRICE_BATCH:
            raise bad('Up to %d prices at once' % PRICE_BATCH)
        seen, ops, at = set(), [], now()
        for it in items:
            pid = str(it.get('productId') or '') if isinstance(it, dict) else ''
            if not pid or pid in seen:
                raise bad('Each part can be on the list once')
            seen.add(pid)
            item, price = load_product(pid), _price(it.get('price'))
            if price == item['selling_price']:
                continue
            ops += [put(dict(item, selling_price=price), ConditionExpression='selling_price = :o', ExpressionAttributeValues={':o': item['selling_price']}), _log(item, item['selling_price'], price, who, at)]
        if not ops:
            raise bad('Those prices are already set')
        return ops, [None] * len(ops), {'updated': len(ops) // 2}
    result = command(key, 'apply-prices', who, body, build)
    _cache['until'] = 0
    return result


def price_history(product_id):
    load_product(product_id)
    return [public(r) for r in query('PRICELOG', forward=False, limit=300) if r['product_id'] == product_id][:50]
