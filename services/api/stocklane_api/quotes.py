"""Estimates (insurance repairs, price can still change) and quotations (a fixed price offer), one record type with a kind. Kept apart from jobs and invoices on purpose:
an estimate never touches stock, never locks anything and never creates a bill.

  WQUO/<id>   estimate: insurer, claim, vehicle, issue details, photos, part lines, labour lines in sections, revisions

An estimate is revised (v1, v2, ...) instead of copied: Revise freezes the current lines as an earlier version and
the working lines carry on as the next one. Convert to job copies the approved lines into a new job in one transaction.
"""
import uuid
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from . import photos, workshop
from .core import COLOMBO, bad, command, conflict, delete, get, missing, now, num, public, put, query
from .workshop import (CHANGED, MONEY, ZERO, clean, history_put, lines_text, money, phone, quantity, regkey, rows, text,
                       vehicle_fields, vehicle_put, FROM_JOBS, km)

STATUSES = ('DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'CONVERTED')
SECTIONS = ('Rem/Refit', 'Repaint', 'Other')
EDITABLE = ('DRAFT', 'SENT', 'APPROVED', 'REJECTED')
MAX_HISTORY = 10


def parts_in(value):
    """Part lines. A price of 0 or empty means "to be confirmed": the print shows TBC instead of a price."""
    out = []
    for r in rows(value, 60, 'parts'):
        price = money(r.get('unit_price') or 0, 'Part price')
        line = {'name': text(r.get('name'), 'Part name', 100, True), 'quantity': quantity(r.get('quantity', 1)), 'unit_price': price}
        if text(r.get('part_no'), 'Part number', 60):
            line['part_no'] = text(r.get('part_no'), 'Part number', 60)
        out.append(line)
    return out


def labour_in(value):
    out = []
    for r in rows(value, 40, 'work'):
        section = text(r.get('section') or 'Other', 'Section', 20)
        if section not in SECTIONS:
            raise bad('Section must be one of: ' + ', '.join(SECTIONS))
        out.append({'description': text(r.get('description'), 'Work description', 100, True), 'amount': money(r.get('amount') or 0, 'Amount'), 'section': section})
    return out


def totals(q):
    parts = sum(((p['quantity'] * p['unit_price']).quantize(MONEY, ROUND_HALF_UP) for p in q.get('parts', [])), ZERO)
    by = {s: ZERO for s in SECTIONS}
    for l in q.get('labour', []):
        by[l.get('section', 'Other')] = by.get(l.get('section', 'Other'), ZERO) + l['amount']
    labour = sum(by.values(), ZERO)
    return {'parts_total': parts, 'labour_total': labour, 'sections': {k: v for k, v in by.items()}, 'total': parts + labour,
            'parts_unpriced': sum(1 for p in q.get('parts', []) if p['unit_price'] == 0)}


def label(q):
    return 'quotation' if q.get('kind') == 'QUOTATION' else 'estimate'


EXPIRING_DAYS = 3


def validity(q):
    """Days left until "valid until" (Colombo calendar days), or None. Only an unanswered estimate/quotation (draft or sent) can expire."""
    v = q.get('valid_until')
    if not v or q.get('status') not in ('DRAFT', 'SENT'):
        return None
    try:
        return (datetime.strptime(v, '%Y-%m-%d').date() - workshop.today()).days
    except ValueError:
        return None


def view(q):
    out = {**public(q), **totals(q)}
    left = validity(q)
    out['days_left'] = left
    out['expired'] = left is not None and left < 0
    out['kind'] = 'QUOTATION' if q.get('kind') == 'QUOTATION' else 'ESTIMATE'
    out['history'] = [{**h, 'total': h['total']} for h in q.get('history', [])]
    return out


def one(quote_id):
    item = get('WQUO', quote_id)
    if not item:
        raise missing('Estimate not found')
    return item


def quotes():
    out = []
    for q in sorted(query('WQUO'), key=lambda q: q['created_at'], reverse=True):
        v = view(q)
        v['lines'] = len(v.pop('parts')) + len(v.pop('labour'))
        v.pop('history', None)
        v['rev_count'] = int(q.get('rev_no', 1))
        v['photo_count'] = len(q.get('photos', []))
        v['front_photo'] = (q.get('photos') or [None])[0]
        v.pop('photos', None)
        v.pop('issue', None)
        out.append(v)
    return out


def get_quote(quote_id):
    return view(one(quote_id))


def _details(q, b):
    for field, label, size, required in (('insurer', 'Insurer', 100, False), ('insurer_branch', 'Insurer branch', 60, False), ('claim_no', 'Claim number', 40, False),
                                         ('policy_no', 'Policy number', 40, False), ('customer', 'Customer name', 100, False), ('vehicle', 'Vehicle make and model', 100, False)):
        if field in b:
            q[field] = text(b[field], label, size, required)
    if 'registration' in b:
        reg = text(b['registration'], 'Vehicle number', 20, True).upper()
        q['registration'], q['vehicle_key'] = reg, regkey(reg)
    if 'phone' in b:
        q['phone'] = phone(b['phone'])
    if 'odometer' in b:
        q['odometer'] = km(b['odometer'], 'Mileage')
    if 'chassis' in b:
        q['chassis'] = workshop.chassis_no(b['chassis']) if b['chassis'] else ''
    if 'issue' in b:
        q['issue'] = lines_text(b['issue'], 'Issue details', 1500)
    if 'valid_until' in b:
        v = str(b['valid_until'] or '').strip()
        if v:
            try:
                datetime.strptime(v, '%Y-%m-%d')
            except ValueError:
                raise bad('Valid until must be a date') from None
        q['valid_until'] = v
    if 'photos' in b:
        q['photos'] = photos.many(b['photos'], 'Photos')
    if 'parts' in b:
        q['parts'] = parts_in(b['parts'])
    if 'labour' in b:
        q['labour'] = labour_in(b['labour'])
    return q


def create(key, who, body):
    def build():
        b = body or {}
        if not str(b.get('registration') or '').strip():
            raise bad('Enter the vehicle number')
        qid, created = str(uuid.uuid4()), now()
        kind = 'QUOTATION' if b.get('kind') == 'QUOTATION' else 'ESTIMATE'
        number = ('QUO-' if kind == 'QUOTATION' else 'EST-') + datetime.now(COLOMBO).strftime('%Y%m%d') + '-' + qid[:4].upper()
        q = {'pk': 'WQUO', 'sk': qid, 'id': qid, 'kind': kind, 'number': number, 'status': 'DRAFT', 'revision': 0, 'rev_no': 1, 'history': [],
             'parts': [], 'labour': [], 'photos': [], 'created_by': who, 'created_at': created, 'updated_at': created}
        q = clean(_details(q, b))
        return [put(q)], [None], view(q)
    return command(key, 'create-quote', who, body, build)


def save(quote_id, key, who, body):
    def build():
        current, b = one(quote_id), body or {}
        if current['status'] == 'CONVERTED':
            raise conflict('This %s was already made into a job' % label(current))
        if num(b.get('revision'), 'Revision') != current['revision']:
            raise conflict(CHANGED)
        q = clean(_details(dict(current), b))
        if 'registration' not in q:
            raise bad('Enter the vehicle number')
        q['revision'], q['updated_at'] = int(current['revision']) + 1, now()
        op = put(q, ConditionExpression='revision = :r and #s <> :done', ExpressionAttributeNames={'#s': 'status'},
                 ExpressionAttributeValues={':r': current['revision'], ':done': 'CONVERTED'})
        return [op], [CHANGED], view(q)
    return command(key, 'save-quote:' + quote_id, who, body, build)


def revise(quote_id, key, who, body):
    """Freeze the current lines as an earlier version and carry on as the next one (v1 -> v2 ...)."""
    def build():
        current, b = one(quote_id), body or {}
        if current['status'] == 'CONVERTED':
            raise conflict('This %s was already made into a job' % label(current))
        if num(b.get('revision'), 'Revision') != current['revision']:
            raise conflict(CHANGED)
        history = list(current.get('history', []))
        if len(history) >= MAX_HISTORY:
            raise bad('A %s can be revised %d times' % (label(current), MAX_HISTORY))
        t = totals(current)
        history.append(clean({'rev_no': int(current.get('rev_no', 1)), 'at': now(), 'by': who, 'status': current['status'], 'total': t['total'],
                              'parts': current.get('parts', []), 'labour': current.get('labour', []),
                              'note': text(b.get('note'), 'Note', 200)}))
        q = dict(current, history=history, rev_no=int(current.get('rev_no', 1)) + 1, status='DRAFT', revision=int(current['revision']) + 1, updated_at=now())
        op = put(clean(q), ConditionExpression='revision = :r and #s <> :done', ExpressionAttributeNames={'#s': 'status'},
                 ExpressionAttributeValues={':r': current['revision'], ':done': 'CONVERTED'})
        return [op], [CHANGED], view(clean(q))
    return command(key, 'revise-quote:' + quote_id, who, body, build)


def set_status(quote_id, key, who, body):
    def build():
        current, b = one(quote_id), body or {}
        status = str(b.get('status') or '')
        if status not in ('DRAFT', 'SENT', 'APPROVED', 'REJECTED'):
            raise bad('Status must be one of DRAFT, SENT, APPROVED, REJECTED')
        if current['status'] == 'CONVERTED':
            raise conflict('This %s was already made into a job' % label(current))
        if num(b.get('revision'), 'Revision') != current['revision']:
            raise conflict(CHANGED)
        left = validity(current)
        if status == 'APPROVED' and left is not None and left < 0:
            # prices move: an offer that ran out is not approved as it stands
            raise conflict('This %s ran out on %s. Set a new "valid until" date (and check the prices) before approving it' % (label(current), current['valid_until']))
        if status in ('SENT', 'APPROVED') and not current.get('parts') and not current.get('labour'):
            raise bad('Add at least one part or work line first')
        if status in ('SENT', 'APPROVED') and current.get('kind') == 'QUOTATION' and any(p['unit_price'] == 0 for p in current.get('parts', [])):
            raise bad('A quotation is a fixed price. Price every part before you send it')
        q = dict(current, status=status, revision=int(current['revision']) + 1, updated_at=now(), status_by=who)
        op = put(clean(q), ConditionExpression='revision = :r and #s <> :done', ExpressionAttributeNames={'#s': 'status'},
                 ExpressionAttributeValues={':r': current['revision'], ':done': 'CONVERTED'})
        return [op], [CHANGED], view(clean(q))
    return command(key, 'quote-status:' + quote_id, who, body, build)


def decide(quote_id, decision, name):
    """The customer's own answer, from their link. One answer only: it needs the estimate to be sent and still unanswered, checked again when saving."""
    current = one(quote_id)
    if current['status'] != 'SENT':
        raise conflict('This has already been answered, or is not ready yet. Please contact the workshop.')
    left = validity(current)
    if decision == 'APPROVE' and left is not None and left < 0:
        raise conflict('This offer has run out. Please contact the workshop.')
    at = now()
    new = clean(dict(current, status='APPROVED' if decision == 'APPROVE' else 'REJECTED', revision=int(current['revision']) + 1, updated_at=at, status_by='customer',
                     customer_decision={'decision': decision, 'name': name, 'at': at}))
    from .core import transact
    transact([put(new, ConditionExpression='revision = :r and #s = :sent', ExpressionAttributeNames={'#s': 'status'},
                  ExpressionAttributeValues={':r': current['revision'], ':sent': 'SENT'})], ['This has already been answered. Please contact the workshop.'])
    return {'status': new['status'], 'decision': decision, 'name': name, 'at': at}


def remove(quote_id, key, who, body):
    def build():
        current = one(quote_id)
        if current['status'] == 'CONVERTED':
            raise conflict('This %s was already made into a job, so it stays on record' % label(current))
        return [delete('WQUO', quote_id)], [None], {'deleted': quote_id}
    return command(key, 'delete-quote:' + quote_id, who, body, build)


def convert(quote_id, key, who, body):
    """One new OPEN job with the estimate's lines and photos, and the estimate marked CONVERTED, in one transaction."""
    def build():
        current, b = one(quote_id), body or {}
        if current['status'] == 'CONVERTED':
            raise conflict('This %s was already made into a job' % label(current))
        if current['status'] != 'APPROVED':
            raise bad('Mark the %s as approved first' % label(current))
        if num(b.get('revision'), 'Revision') != current['revision']:
            raise conflict(CHANGED)
        customer = text(current.get('customer'), 'Customer name', 100)
        if not customer:
            raise bad('Add the customer name, then make the job')
        created, job_id = now(), str(uuid.uuid4())
        labour = [{'description': (l['description'] if l.get('section', 'Other') == 'Other' else l['section'] + ' - ' + l['description'])[:100], 'amount': l['amount']}
                  for l in current.get('labour', [])]
        summary = ' '.join(filter(None, ['Insurance ' + current['insurer'] if current.get('insurer') else '',
                                         'claim ' + current['claim_no'] if current.get('claim_no') else '', (current.get('issue') or '').replace('\n', ' ')]))[:1000]
        job_no, counter = workshop.next_job_no()
        from . import customers
        customer_id, customer_ops = customers.resolve(customer, current.get('phone', ''), who)
        j = clean({'pk': 'WJOB', 'sk': job_id, 'id': job_id, 'job_no': job_no, 'customer_id': customer_id, 'chassis': current.get('chassis', ''),
                   'invoice_type': 'INSURANCE' if current.get('insurer') else 'CASH',
                   'registration': current['registration'], 'vehicle_key': current['vehicle_key'],
                   'customer': customer, 'phone': current.get('phone', ''), 'address': '', 'vehicle': current.get('vehicle', ''), 'odometer': current.get('odometer'),
                   'summary': summary, 'mechanic': '', 'notes': '', 'status': 'OPEN', 'revision': 0, 'stage': 'WAITING', 'brought_by': '', 'brought_phone': '',
                   'parts': [dict(p, added_at=workshop.today().isoformat()) for p in current.get('parts', [])], 'labour': labour, 'discount': ZERO, 'quote_id': quote_id, 'quote_number': current['number'],
                   'created_by': who, 'created_at': created, 'updated_at': created})
        ops = [put(j), vehicle_put(j['vehicle_key'], vehicle_fields(j), fill_only=FROM_JOBS), history_put(j), counter] + customer_ops
        if current.get('photos'):
            ops.append(put({'pk': 'WJPH', 'sk': job_id, 'before': list(current['photos'])[:6], 'n': 1, 'updated_at': created}))
        done = clean(dict(current, status='CONVERTED', job_id=job_id, revision=int(current['revision']) + 1, updated_at=created))
        ops.append(put(done, ConditionExpression='revision = :r and #s = :ok', ExpressionAttributeNames={'#s': 'status'},
                       ExpressionAttributeValues={':r': current['revision'], ':ok': 'APPROVED'}))
        labels = [None] * (len(ops) - 1) + [CHANGED]
        return ops, labels, {'job_id': job_id, 'quote': view(done)}
    return command(key, 'convert-quote:' + quote_id, who, body, build)


def counts():
    """For Home: estimates still waiting for the insurer/customer to answer, and quotations that end within a few days."""
    waiting = expiring = 0
    for q in query('WQUO'):
        if q.get('status') == 'SENT' and q.get('kind') != 'QUOTATION':
            waiting += 1
        left = validity(q)
        if q.get('kind') == 'QUOTATION' and left is not None and 0 <= left <= EXPIRING_DAYS:
            expiring += 1
    return {'estimates_waiting': waiting, 'quotes_expiring': expiring}
