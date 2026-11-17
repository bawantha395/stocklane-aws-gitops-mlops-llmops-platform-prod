"""Suppliers: who the shop buys parts from, kept once instead of typed on every delivery.

  SUPP/<id>               the supplier (name, kind MAIN or LOCAL, phones, address, credit days, notes, active)
  UNIQ/SUPNAME#<name>     one supplier per name (case ignored)

Deliveries (GRN), the usual supplier of a part and parts bought outside carry the supplier's id and a snapshot of its name that day, so a
renamed supplier never rewrites an old note. Older rows that only have a typed name are matched to the supplier by that name. A supplier is
never deleted: it is closed, and then leaves the pick lists while its history stays.
"""
import re
import uuid
from decimal import Decimal

from .core import bad, command, conflict, get, missing, now, num, public, put, query, delete
from .customers import canon
from .workshop import CHANGED, ZERO, clean, lines_text, phone, text

KINDS = ('MAIN', 'LOCAL')
ZERO_COST = Decimal('0')


def one(supplier_id):
    s = get('SUPP', str(supplier_id or ''))
    if not s:
        raise missing('Supplier not found')
    return s


def name_key(name):
    return re.sub(r'\s+', ' ', str(name or '').strip().lower())


def by_name(name):
    k = name_key(name)
    row = get('UNIQ', 'SUPNAME#' + k) if k else None
    return get('SUPP', row['supplier_id']) if row else None


def resolve(supplier_id, typed='', keep=None):
    """(supplier_id or None, name) for a delivery, a part or an outside purchase. A chosen supplier must exist and be open (unless it is
    the one already on the record, `keep`). A typed name that matches a supplier is linked to it; any other typed name stays a plain name."""
    if supplier_id:
        s = one(supplier_id)
        if not s.get('active', True) and s['id'] != keep:
            raise bad('%s is closed. Open it again in Suppliers, or choose another supplier.' % s['name'])
        return s['id'], s['name']
    name = text(typed, 'Supplier', 100, False)
    s = by_name(name) if name else None
    if s and s.get('active', True):
        return s['id'], s['name']
    return None, name


def name_of(supplier_id):
    return one(supplier_id)['name']


def names():
    """id -> current name, for showing a renamed supplier on the parts it supplies."""
    return {s['id']: s['name'] for s in query('SUPP')}


def card(s, parts=0):
    return {'id': s['id'], 'name': s['name'], 'kind': s.get('kind', 'MAIN'), 'phone': s.get('phone', ''), 'whatsapp': s.get('whatsapp', ''),
            'credit_days': int(s.get('credit_days') or 0), 'active': s.get('active', True), 'parts': parts, 'updated_at': s['updated_at']}


def suppliers(search='', kind='', inactive=False):
    needle = search.strip().lower()
    counts = {}
    for p in query('PRODUCT'):
        if p.get('supplier_id') and not p.get('archived'):
            counts[p['supplier_id']] = counts.get(p['supplier_id'], 0) + 1
    out = []
    for s in query('SUPP'):
        if not s.get('active', True) and not inactive:
            continue
        if kind and s.get('kind', 'MAIN') != kind:
            continue
        digits = ''.join(c for c in needle if c.isdigit())
        if needle and needle not in s['name'].lower() and not (len(digits) >= 3 and digits in canon(s.get('phone')) + canon(s.get('whatsapp'))):
            continue
        out.append(card(s, counts.get(s['id'], 0)))
    return sorted(out, key=lambda s: s['name'].lower())


def supplier(supplier_id, with_cost=False):
    """The supplier's page: details, its deliveries (newest first), the parts it supplies, and what was bought (cost is for those who may see it)."""
    s = one(supplier_id)
    me = name_key(s['name'])
    docs = {}
    for m in query('MOVE', forward=False):
        if m.get('kind') != 'RECEIPT':
            continue
        if m.get('supplier_id') != s['id'] and not (not m.get('supplier_id') and name_key(m.get('supplier')) == me):
            continue
        d = docs.setdefault(m.get('doc_no') or m['id'], {'doc_no': m.get('doc_no'), 'created_at': m['created_at'], 'reference': m.get('reference', ''),
                                                           'lines': 0, 'quantity': ZERO, 'cost': ZERO, 'unknown': 0, 'id': m['id']})
        d['lines'] += 1
        d['quantity'] += m['quantity']
        if m.get('unit_cost') is not None:
            d['cost'] += m['unit_cost'] * m['quantity']
        else:
            d['unknown'] += 1
    deliveries = sorted(docs.values(), key=lambda d: d['created_at'], reverse=True)
    parts = []
    for p in query('PRODUCT'):
        if p.get('archived') or (p.get('supplier_id') != s['id'] and not (not p.get('supplier_id') and name_key(p.get('supplier')) == me)):
            continue
        row = {'id': p['id'], 'name': p['name'], 'sku': p['sku'], 'quantity': p['quantity'], 'unit': p['unit'], 'location': p.get('location', '')}
        if with_cost:
            row.update(last_cost=p.get('last_cost'), last_cost_at=p.get('last_cost_at'))
        parts.append(row)
    out = {**public(s), 'credit_days': int(s.get('credit_days') or 0), 'deliveries': [dict(d, cost=d['cost']) for d in deliveries[:60]] if with_cost else
           [{k: v for k, v in d.items() if k not in ('cost', 'unknown')} for d in deliveries[:60]],
           'delivery_count': len(deliveries), 'parts': sorted(parts, key=lambda p: p['name'].lower()), 'last_delivery': deliveries[0]['created_at'] if deliveries else None}
    if with_cost:
        out['bought'] = sum((d['cost'] for d in deliveries), ZERO)
    return out


def credit_days(value):
    n = num(value if value not in (None, '') else 0, 'Credit days')
    if n != n.to_integral_value() or not 0 <= n <= 365:
        raise bad('Credit days is a whole number from 0 to 365')
    return int(n)


def kind(value):
    v = str(value or 'MAIN').strip().upper()
    if v not in KINDS:
        raise bad('Choose the supplier type: main supplier or local shop')
    return v


def number(value, label):
    v = phone(value)
    if v and not canon(v):
        raise bad(label + ': enter the full number (at least 9 digits)')
    return v


def same_phone(c, exclude=None):
    """Another open supplier that already has one of these numbers."""
    mine = {canon(c.get('phone')), canon(c.get('whatsapp'))} - {''}
    if not mine:
        return None
    for s in query('SUPP'):
        if s['id'] != exclude and mine & ({canon(s.get('phone')), canon(s.get('whatsapp'))} - {''}):
            return s
    return None


def create(key, who, body):
    def build():
        b = body or {}
        sid, at = str(uuid.uuid4()), now()
        s = clean({'pk': 'SUPP', 'sk': sid, 'id': sid, 'name': text(b.get('name'), 'Supplier name', 100, True), 'kind': kind(b.get('kind')),
                   'phone': number(b.get('phone'), 'Phone'), 'whatsapp': number(b.get('whatsapp'), 'WhatsApp'), 'address': lines_text(b.get('address'), 'Address', 200),
                   'credit_days': credit_days(b.get('credit_days')), 'notes': lines_text(b.get('notes'), 'Notes', 1000), 'active': True, 'revision': 0,
                   'created_by': who, 'created_at': at, 'updated_at': at})
        twin = same_phone(s)
        if twin and not b.get('allow_same_phone'):
            raise conflict('%s already has this number. Save again to add it as a separate supplier.' % twin['name'])
        ops = [put(s, ConditionExpression='attribute_not_exists(pk)'),
               put({'pk': 'UNIQ', 'sk': 'SUPNAME#' + name_key(s['name']), 'supplier_id': sid}, ConditionExpression='attribute_not_exists(pk)')]
        return ops, [None, 'A supplier called %s already exists' % s['name']], public(s)
    return command(key, 'create-supplier', who, body, build)


def edit(supplier_id, key, who, body):
    def build():
        s, b = one(supplier_id), body or {}
        if num(b.get('revision'), 'Revision') != s['revision']:
            raise conflict(CHANGED)
        n = dict(s)
        if 'name' in b:
            n['name'] = text(b['name'], 'Supplier name', 100, True)
        if 'kind' in b:
            n['kind'] = kind(b['kind'])
        for field, label in (('phone', 'Phone'), ('whatsapp', 'WhatsApp')):
            if field in b:
                n[field] = number(b[field], label)
        if 'address' in b:
            n['address'] = lines_text(b['address'], 'Address', 200)
        if 'credit_days' in b:
            n['credit_days'] = credit_days(b['credit_days'])
        if 'notes' in b:
            n['notes'] = lines_text(b['notes'], 'Notes', 1000)
        if 'active' in b:
            n['active'] = bool(b['active'])
        twin = same_phone(n, exclude=s['id']) if (n.get('phone') != s.get('phone') or n.get('whatsapp') != s.get('whatsapp')) else None
        if twin and not b.get('allow_same_phone'):
            raise conflict('%s already has this number. Save again to keep both.' % twin['name'])
        n['revision'], n['updated_at'] = int(s['revision']) + 1, now()
        n = clean(n)
        if clean(dict(n, revision=s['revision'], updated_at=s['updated_at'])) == clean(s):
            raise bad('Nothing to change')
        ops = [put(n, ConditionExpression='revision = :r', ExpressionAttributeValues={':r': s['revision']})]
        labels = [CHANGED]
        if name_key(n['name']) != name_key(s['name']):
            ops += [delete('UNIQ', 'SUPNAME#' + name_key(s['name'])),
                    put({'pk': 'UNIQ', 'sk': 'SUPNAME#' + name_key(n['name']), 'supplier_id': s['id']}, ConditionExpression='attribute_not_exists(pk)')]
            labels += [None, 'A supplier called %s already exists' % n['name']]
        return ops, labels, public(n)
    return command(key, 'edit-supplier:' + supplier_id, who, body, build)
