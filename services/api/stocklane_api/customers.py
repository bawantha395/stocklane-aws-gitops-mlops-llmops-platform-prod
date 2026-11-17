"""Customers: one record per person or company, found by phone number.

  CUST/<id>                    the customer (name, phones, address, birthday, kind, notes)
  UNIQ/CPHONE#<number>         one row per phone number the customer has ever had -> customer_id (a number belongs to one customer)

A job with a phone number finds that customer or makes one (resolve), so nobody types a customer twice. Vehicles, jobs and bills carry
`customer_id`; the name and phone printed on a job or bill stay as they were that day. A job without a phone number belongs to nobody
(a walk-in). A customer is never deleted (bills hang on them): it is switched to inactive, or merged into another one.
"""
import re
import uuid
from datetime import date

from .core import bad, command, conflict, get, missing, now, num, public, put, query, update
from .workshop import (CHANGED, ZERO, clean, lines_text, local_date, phone, regkey, settled, text, totals, business)

KINDS = ('WALKIN', 'REGULAR', 'FLEET', 'INSURANCE')
MAX_NAMES = 5
MAX_ALIASES = 6
MOVE_AT_ONCE = 80  # documents moved per merge step (one transaction holds 100 operations)


def canon(value):
    """One spelling for a phone number: 0771234567 whether typed as 077 123 4567, +94 77 123 4567 or 0094771234567. '' when too short to trust."""
    d = ''.join(c for c in str(value or '') if c.isdigit())
    if d.startswith('0094'):
        d = '0' + d[4:]
    elif d.startswith('94') and len(d) == 11:
        d = '0' + d[2:]
    elif len(d) == 9:
        d = '0' + d
    return d if len(d) >= 9 else ''


def shown(value):
    """How a number is stored: the plain 10-digit form for Sri Lankan numbers, as typed for any other."""
    k = canon(value)
    return k if re.fullmatch(r'0\d{9}', k) else str(value or '').strip()


def numbers(c):
    return {k for k in [canon(c.get('phone')), canon(c.get('phone2')), *[canon(a) for a in c.get('aliases') or []]] if k}


def uniq(k, customer_id):
    return put({'pk': 'UNIQ', 'sk': 'CPHONE#' + k, 'customer_id': customer_id}, ConditionExpression='attribute_not_exists(pk)')


def one(customer_id):
    c = get('CUST', str(customer_id or ''))
    if not c:
        raise missing('Customer not found')
    return c


def by_phone(value):
    k = canon(value)
    row = get('UNIQ', 'CPHONE#' + k) if k else None
    return get('CUST', row['customer_id']) if row else None


def resolve(name, phone_value, who, address=''):
    """The customer for this name and phone: (customer_id, operations). Found by phone, or made. No usable phone: (None, [])
    (a walk-in). Used inside a command's transaction; a clash with someone doing the same is retried by command()."""
    if not canon(phone_value):
        return None, []
    c = by_phone(phone_value)
    if c:
        names = list(c.get('names') or [])
        change = {}
        if name and name != c.get('name') and name not in names and len(names) < MAX_NAMES:
            change['names'] = names + [name]
        if not c.get('active', True):
            change['active'] = True
        if not change:
            return c['id'], []
        row = clean(dict(c, **change, revision=int(c['revision']) + 1, updated_at=now()))
        return c['id'], [put(row, ConditionExpression='revision = :r', ExpressionAttributeValues={':r': c['revision']})]
    cid, at = str(uuid.uuid4()), now()
    row = clean({'pk': 'CUST', 'sk': cid, 'id': cid, 'name': name or 'Customer', 'phone': shown(phone_value), 'address': address or '', 'kind': 'WALKIN',
                 'active': True, 'names': [], 'aliases': [], 'revision': 0, 'created_by': who, 'created_at': at, 'updated_at': at})
    return cid, [put(row, ConditionExpression='attribute_not_exists(pk)'), uniq(canon(phone_value), cid)]


# ---------- reading ----------
def groups():
    """customer_id -> counts from the vehicles, jobs and bills that point at it."""
    out = {}

    def slot(cid):
        return out.setdefault(cid, {'vehicles': [], 'jobs': 0, 'owing': ZERO, 'bills': 0})
    for v in query('VEHICLE'):
        if v.get('customer_id'):
            slot(v['customer_id'])['vehicles'].append(v)
    for j in query('WJOB'):
        if j.get('customer_id') and j['status'] != 'ARCHIVED':
            slot(j['customer_id'])['jobs'] += 1
    for i in query('WINV'):
        if i.get('customer_id'):
            i = settled(i)
            if i['status'] in ('UNPAID', 'PARTIAL'):
                slot(i['customer_id'])['owing'] += i['total'] - i['paid']
            if i['status'] != 'VOID':
                slot(i['customer_id'])['bills'] += 1
    return out


def row_of(c, g):
    regs = [v['registration'] for v in g['vehicles']]
    return {'id': c['id'], 'name': c['name'], 'phone': c.get('phone', ''), 'phone2': c.get('phone2', ''), 'kind': c.get('kind', 'WALKIN'),
            'active': c.get('active', True), 'birthday': c.get('birthday', ''), 'vehicles': len(regs), 'regs': regs[:3], 'jobs': g['jobs'],
            'owing': g['owing'], 'updated_at': c['updated_at']}


def customers(search='', inactive=False):
    needle = search.strip().lower()
    digits = ''.join(ch for ch in needle if ch.isdigit())
    counts, out = groups(), []
    for c in query('CUST'):
        if c.get('merged_into') or (not c.get('active', True) and not inactive):
            continue
        r = row_of(c, counts.get(c['id']) or {'vehicles': [], 'jobs': 0, 'owing': ZERO})
        if needle:
            hay = (c['name'] + ' ' + ' '.join(c.get('names') or []) + ' ' + ' '.join(regkey(x) for x in r['regs'])).lower()
            hit = needle in hay or (len(digits) >= 3 and any(digits in n for n in numbers(c)))
            if not hit:
                hit = any(needle.replace(' ', '').replace('-', '') in regkey(v['registration']).lower() for v in (counts.get(c['id']) or {'vehicles': []})['vehicles'])
            if not hit:
                continue
        out.append(r)
    return sorted(out, key=lambda r: r['updated_at'], reverse=True)[:200]


def lookup(search):
    """For the new-job form: customers whose number or name starts like this, with their vehicles. Short, so it can run while typing."""
    needle = str(search or '').strip().lower()
    digits = ''.join(ch for ch in needle if ch.isdigit())
    if len(digits) < 4 and len(needle) < 3:
        return []
    owned = {}
    for v in query('VEHICLE'):
        if v.get('customer_id'):
            owned.setdefault(v['customer_id'], []).append({'registration': v['registration'], 'make': v.get('make', ''), 'last_km': v.get('last_km')})
    out = []
    for c in query('CUST'):
        if c.get('merged_into') or not c.get('active', True):
            continue
        if (len(digits) >= 4 and any(digits in n for n in numbers(c))) or (not digits and needle in c['name'].lower()):
            out.append({'id': c['id'], 'name': c['name'], 'phone': c.get('phone', ''), 'address': c.get('address', ''), 'kind': c.get('kind', 'WALKIN'),
                        'vehicles': sorted(owned.get(c['id'], []), key=lambda v: v['registration'])[:6]})
    return out[:6]


def customer(customer_id):
    c = one(customer_id)
    if c.get('merged_into'):
        raise missing('This customer was merged into another one')
    g = groups().get(c['id']) or {'vehicles': [], 'jobs': 0, 'owing': ZERO, 'bills': 0}
    rate = business()['tax_rate']
    bills = {}
    for i in query('WINV'):
        if i.get('customer_id') == c['id']:
            bills[i['job_id']] = settled(i)
    timeline = []
    for j in sorted((j for j in query('WJOB') if j.get('customer_id') == c['id'] and j['status'] != 'ARCHIVED'), key=lambda j: j['created_at'], reverse=True)[:60]:
        row = {'id': j['id'], 'job_no': j.get('job_no'), 'registration': j['registration'], 'created_at': j['created_at'], 'status': j['status'],
               'stage': j.get('stage'), 'summary': j.get('summary', ''), 'name': j.get('customer', '')}
        inv = bills.get(j['id'])
        if inv and inv['status'] != 'VOID':
            row.update(total=inv['total'], paid=inv['paid'], balance=ZERO if inv['status'] == 'REFUNDED' else inv['total'] - inv['paid'],
                       pay_status=inv['status'], invoice_id=inv['id'], invoice_number=inv['invoice_number'])
        elif j['status'] == 'OPEN':
            row['total'] = totals(j, rate)['total']
        timeline.append(row)
    spent = sum((i['total'] for i in bills.values() if i['status'] not in ('VOID',)), ZERO)
    return {**public(c), 'vehicle_list': [{'registration': v['registration'], 'make': v.get('make', ''), 'last_km': v.get('last_km'), 'owner': v.get('owner', '')}
                                          for v in sorted(g['vehicles'], key=lambda v: v['registration'])],
            'timeline': timeline, 'owing': g['owing'], 'spent': spent, 'bills': g['bills'], 'jobs': g['jobs']}


# ---------- writing ----------
def birthday(value):
    v = str(value or '').strip()
    if not v:
        return ''
    m = re.fullmatch(r'(?:(\d{4})-)?(\d{2})-(\d{2})', v)
    if not m:
        raise bad('Birthday: use month and day (12-25) or the full date')
    try:
        date(int(m.group(1) or 2000), int(m.group(2)), int(m.group(3)))
    except ValueError:
        raise bad('That birthday is not a real date') from None
    return v


def kind(value):
    v = str(value or 'REGULAR').strip().upper()
    if v not in KINDS:
        raise bad('Choose the customer type: walk-in, regular, fleet or insurance')
    return v


def number_in(value, field):
    v = phone(value)
    if v and not canon(v):
        raise bad(field + ': enter the full number (at least 9 digits)')
    return shown(v) if v else ''


def claim(c, wanted, mine):
    """Operations that give this customer every number in `wanted` that it does not hold yet; refuses a number another customer holds."""
    ops = []
    for k in sorted(wanted - mine):
        other = get('UNIQ', 'CPHONE#' + k)
        if other and other['customer_id'] != c['id']:
            raise conflict('The number %s already belongs to %s' % (k, (get('CUST', other['customer_id']) or {}).get('name', 'another customer')))
        if not other:
            ops.append(uniq(k, c['id']))
    return ops


def create(key, who, body):
    def build():
        b = body or {}
        cid, at = str(uuid.uuid4()), now()
        c = clean({'pk': 'CUST', 'sk': cid, 'id': cid, 'name': text(b.get('name'), 'Name', 100, True), 'phone': number_in(b.get('phone'), 'Phone'),
                   'phone2': number_in(b.get('phone2'), 'Second phone'), 'address': lines_text(b.get('address'), 'Address', 200),
                   'birthday': birthday(b.get('birthday')), 'kind': kind(b.get('kind')), 'notes': lines_text(b.get('notes'), 'Notes', 1000),
                   'active': True, 'names': [], 'aliases': [], 'revision': 0, 'created_by': who, 'created_at': at, 'updated_at': at})
        ops = [put(c, ConditionExpression='attribute_not_exists(pk)')] + claim(c, numbers(c), set())
        return ops, [None] * len(ops), public(c)
    return command(key, 'create-customer', who, body, build)


def edit(customer_id, key, who, body):
    def build():
        c, b = one(customer_id), body or {}
        if c.get('merged_into'):
            raise conflict('This customer was merged into another one')
        if num(b.get('revision'), 'Revision') != c['revision']:
            raise conflict(CHANGED)
        n = dict(c)
        if 'name' in b:
            n['name'] = text(b['name'], 'Name', 100, True)
        for field, label in (('phone', 'Phone'), ('phone2', 'Second phone')):
            if field in b:
                n[field] = number_in(b[field], label)
        if 'address' in b:
            n['address'] = lines_text(b['address'], 'Address', 200)
        if 'birthday' in b:
            n['birthday'] = birthday(b['birthday'])
        if 'kind' in b:
            n['kind'] = kind(b['kind'])
        if 'notes' in b:
            n['notes'] = lines_text(b['notes'], 'Notes', 1000)
        if 'active' in b:
            n['active'] = bool(b['active'])
        had = numbers(c)
        # a number the customer stops using stays theirs (old vehicle files and jobs still carry it), kept as an alias
        live = {k for k in (canon(n.get('phone')), canon(n.get('phone2'))) if k}
        aliases = list(c.get('aliases') or [])
        aliases += [k for k in sorted(had - live) if k not in {canon(a) for a in aliases}]
        n['aliases'] = [a for a in aliases if canon(a) not in live][-MAX_ALIASES:]
        ops = claim(c, numbers(n), had)
        n['revision'], n['updated_at'] = int(c['revision']) + 1, now()
        n = clean(n)
        if n == clean(dict(c, revision=n['revision'], updated_at=n['updated_at'])):
            raise bad('Nothing to change')
        ops.insert(0, put(n, ConditionExpression='revision = :r', ExpressionAttributeValues={':r': c['revision']}))
        return ops, [CHANGED] + [None] * (len(ops) - 1), public(n)
    return command(key, 'edit-customer:' + customer_id, who, body, build)


def merge(source_id, key, who, body):
    """Two records of one person become one: vehicles, jobs and bills of `source` move to `into`, then `source` is closed and its phone
    numbers point at `into`. A big customer moves in steps: when `done` is false, send it again."""
    def build():
        b = body or {}
        src, dst = one(source_id), one(b.get('into'))
        if src['id'] == dst['id']:
            raise bad('Choose a different customer to merge into')
        if src.get('merged_into'):
            raise conflict('This customer was already merged')
        if dst.get('merged_into'):
            raise bad('That customer was merged into another one. Choose the one that is left.')
        todo = [(kind_, r['sk']) for kind_ in ('VEHICLE', 'WJOB', 'WINV') for r in query(kind_) if r.get('customer_id') == src['id']]
        chunk = todo[:MOVE_AT_ONCE]
        ops = [update(k, sk, 'SET customer_id = :t, revision = if_not_exists(revision, :z) + :one', {':t': dst['id'], ':z': 0, ':one': 1}, condition='attribute_exists(pk)')
               for k, sk in chunk]
        rest = len(todo) - len(chunk)
        if not rest:
            keys = sorted(numbers(src))
            mine = [a for a in (dst.get('aliases') or [])]
            names = list(dst.get('names') or [])
            for name in [src['name']] + list(src.get('names') or []):
                if name != dst['name'] and name not in names and len(names) < MAX_NAMES:
                    names.append(name)
            extra = [k for k in keys if k not in numbers(dst)]
            merged = dict(dst, names=names, aliases=(mine + extra)[-MAX_ALIASES:], revision=int(dst['revision']) + 1, updated_at=now())
            if not merged.get('phone2') and extra:
                merged['phone2'], merged['aliases'] = shown(extra[0]), [a for a in merged['aliases'] if a != extra[0]]
            ops.append(put(clean(merged), ConditionExpression='revision = :r', ExpressionAttributeValues={':r': dst['revision']}))
            ops.append(put(clean(dict(src, merged_into=dst['id'], active=False, revision=int(src['revision']) + 1, updated_at=now())),
                           ConditionExpression='revision = :r', ExpressionAttributeValues={':r': src['revision']}))
            for k in keys:
                ops.append(put({'pk': 'UNIQ', 'sk': 'CPHONE#' + k, 'customer_id': dst['id']}, ConditionExpression='customer_id = :s', ExpressionAttributeValues={':s': src['id']}))
        return ops, [None] * len(ops), {'done': not rest, 'moved': len(chunk), 'remaining': rest, 'into': dst['id']}
    return command(key, 'merge-customer:' + source_id, who, body, build)


# ---------- the statement ----------
def statement_pdf(customer_id):
    from . import bills
    c = customer(customer_id)
    shop = business()
    owed, paid_rows = [], []
    for i in query('WINV'):
        if i.get('customer_id') != c['id']:
            continue
        i = settled(i)
        if i['status'] in ('UNPAID', 'PARTIAL'):
            owed.append({'date': local_date(i['created_at']).isoformat(), 'number': i['invoice_number'], 'registration': i.get('registration', ''),
                         'total': i['total'], 'paid': i['paid'], 'balance': i['total'] - i['paid']})
            for p in i.get('payments') or []:
                if not p.get('refund'):
                    paid_rows.append({'date': local_date(p['at']).isoformat(), 'number': i['invoice_number'], 'method': p.get('method', ''), 'amount': p['amount']})
    owed.sort(key=lambda r: r['date'])
    paid_rows.sort(key=lambda r: r['date'])
    data = {'customer': c, 'owed': owed, 'payments': paid_rows, 'balance': sum((r['balance'] for r in owed), ZERO), 'printed': local_date(now()).isoformat(), 'currency': 'LKR'}
    return bills.statement(data, shop), 'STATEMENT-' + re.sub(r'[^A-Za-z0-9]', '', c['name'])[:20]
