"""Customer links: a private web address for one job that the customer opens on their phone, with no sign-in.

The address holds a long random secret (`<shop>~<secret>`). Anyone who has it sees that one job and nothing else, until it expires or the
owner revokes it. A wrong, expired or revoked address all answer the same 404, so nobody can tell which. Repeated wrong guesses from one
address are slowed down (RATE rows, outside every shop, expire by themselves).

What a customer is shown is chosen field by field below. Costs, profit, staff names, other customers and the shop's books are never copied in.

  LINK/<secret>            the link: job, shop, expiry, revoked, views
  JLINK#<job id>/<secret>  the same link found from its job (to show or revoke it)
"""
import secrets
import time
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

from . import photos
from .core import ApiError, bad, command, get, missing, now, put, query, set_shop, table, update

DEFAULT_DAYS, MAX_DAYS = 14, 60
STAGES = ('WAITING', 'IN_PROGRESS', 'PARTS', 'READY')
TRY_LIMIT, TRY_WINDOW = 20, 600   # wrong guesses allowed per source address in 10 minutes
VIEW_LIMIT = 120                  # any requests per source address in 10 minutes


def _now_s():
    return int(time.time())


def _expiry(days):
    from .workshop import today
    return (today() + timedelta(days=days)).isoformat()


def throttle(source, failed=False):
    """Count this request against its source address; refuse once the allowance is used. Kept in the table with a ttl, outside every shop."""
    bucket = _now_s() // TRY_WINDOW
    for kind, limit in ((('bad', TRY_LIMIT),) if failed else (('all', VIEW_LIMIT),)):
        row = table().update_item(Key={'pk': 'RATE#%s#%s' % (kind, source or 'unknown'), 'sk': str(bucket)}, UpdateExpression='ADD n :one SET #t = :ttl',
                                  ExpressionAttributeNames={'#t': 'ttl'}, ExpressionAttributeValues={':one': 1, ':ttl': (bucket + 2) * TRY_WINDOW}, ReturnValues='UPDATED_NEW')
        if int(row['Attributes']['n']) > limit:
            raise ApiError(429, 'Too many tries. Please wait a few minutes.')


def blocked(source):
    """Already over the wrong-guess allowance? Checked before looking anything up, so guessing gets no answer at all."""
    bucket = _now_s() // TRY_WINDOW
    row = table().get_item(Key={'pk': 'RATE#bad#%s' % (source or 'unknown'), 'sk': str(bucket)}).get('Item')
    if row and int(row.get('n', 0)) > TRY_LIMIT:
        raise ApiError(429, 'Too many tries. Please wait a few minutes.')


# ---------- staff side ----------
def active_for(sid):
    for r in sorted(query('JLINK#' + sid), key=lambda r: r['created_at'], reverse=True):
        if not r.get('revoked') and r['expires'] >= _expiry(0):
            return r
    return None


def shown(r):
    return {'token': '%s~%s' % (r['shop'], r['secret']), 'expires': r['expires'], 'created_at': r['created_at'], 'views': int(r.get('views') or 0)} if r else None


def _subject(kind, sid):
    """The job or quote this link is for (raises 404 if it is not there)."""
    if kind == 'quote':
        from .quotes import one
        return one(sid)
    from .workshop import job
    return job(sid)


def current(sid, kind='job'):
    _subject(kind, sid)
    return {'link': shown(active_for(sid))}


def _new_row(sid, kind, who, days):
    from .core import shop
    return {'secret': secrets.token_urlsafe(18), 'shop': shop(), ('quote_id' if kind == 'quote' else 'job_id'): sid, 'created_by': who, 'created_at': now(),
            'expires': _expiry(days), 'revoked': False, 'views': 0, 'ttl': _now_s() + (days + 30) * 86400}


def _rows(row, sid):
    return [put(dict(row, pk='LINK', sk=row['secret'])), put(dict(row, pk='JLINK#' + sid, sk=row['secret']))]


def ensure(job_id):
    """The live link for a job, made if there is none (used when a message is prepared). Plain writes: the same job always gets the same link."""
    from .core import transact
    _subject('job', job_id)
    live = active_for(job_id)
    if live:
        return shown(live)
    row = _new_row(job_id, 'job', 'messages', DEFAULT_DAYS)
    transact(_rows(row, job_id), [None, None])
    return shown(row)


def create(sid, key, who, body, kind='job'):
    """Make (or return the live) link for a job or estimate. Asking twice gives the same address, so a link already sent keeps working."""
    def build():
        item = _subject(kind, sid)
        if item['status'] == 'ARCHIVED':
            raise bad('This job was deleted')
        days = (body or {}).get('days', DEFAULT_DAYS)
        if not isinstance(days, int) or isinstance(days, bool) or not 1 <= days <= MAX_DAYS:
            raise bad('Choose 1 to %d days' % MAX_DAYS)
        live = active_for(sid)
        if live:
            return [], [], {'link': shown(live)}
        row = _new_row(sid, kind, who, days)
        return _rows(row, sid), [None, None], {'link': shown(row)}
    return command(key, 'link:' + sid, who, body, build)


def revoke(sid, key, who, body, kind='job'):
    def build():
        _subject(kind, sid)
        ops = []
        for r in query('JLINK#' + sid):
            if not r.get('revoked'):
                ops += [update('LINK', r['secret'], 'SET revoked = :t, revoked_by = :b', {':t': True, ':b': who}),
                        update('JLINK#' + sid, r['secret'], 'SET revoked = :t, revoked_by = :b', {':t': True, ':b': who})]
        return ops, [None] * len(ops), {'link': None, 'revoked': len(ops) // 2}
    return command(key, 'link-revoke:' + sid, who, body, build)


# ---------- the public side ----------
def open_link(token, source):
    """The link row for a token, or the one 404 every bad token gets. Sets the shop (the token names it)."""
    blocked(source)
    shop, _, secret = str(token or '').partition('~')
    try:
        if not secret or len(secret) > 60:
            raise missing('Not found')
        set_shop(shop)
        from . import platform
        platform.admit(shop)
        row = get('LINK', secret)
        if not row or row.get('revoked') or row['expires'] < _expiry(0):
            raise missing('Not found')
        return row
    except ApiError as e:
        if e.status in (403, 404):
            throttle(source, failed=True)
            raise missing('Not found') from None
        raise


PHOTO_KINDS = ('before', 'after', 'old')   # condition before the repair, after it, and the old parts that came off


def photo_groups(job_id):
    held = get('WJPH', job_id) or {}
    return {k: list(held.get(k, []))[:6] for k in PHOTO_KINDS}


def _shop_card(shop):
    return {k: shop.get(k) or '' for k in ('name', 'address', 'phone')}


def _quote_page(q, link, shop):
    from . import quotes
    left = quotes.validity(q)
    expired = left is not None and left < 0
    d = q.get('customer_decision')
    lines = [{'name': p['name'], 'quantity': p['quantity'], 'amount': (p['quantity'] * p['unit_price']).quantize(Decimal('0.01'), ROUND_HALF_UP)} for p in q.get('parts', [])]
    work = [{'description': l['description'] if l.get('section', 'Other') == 'Other' else '%s - %s' % (l['section'], l['description']), 'amount': l['amount']} for l in q.get('labour', [])]
    total = sum((x['amount'] for x in lines), Decimal(0)) + sum((x['amount'] for x in work), Decimal(0))
    return {'kind': 'quote', 'shop': _shop_card(shop), 'expires': link['expires'],
            'quote': {'number': q.get('number', ''), 'type': q.get('kind') or 'ESTIMATE', 'registration': q.get('registration', ''), 'vehicle': q.get('vehicle', ''),
                      'customer': q.get('customer', ''), 'status': q['status'], 'valid_until': q.get('valid_until') or '', 'expired': expired,
                      'parts': lines, 'labour': work, 'total': total, 'can_decide': q['status'] == 'SENT' and not expired,
                      'decision': {'decision': d['decision'], 'name': d['name'], 'at': d['at']} if d else None},
            'photos': {'before': list(q.get('photos') or [])[:6], 'after': [], 'old': []}}


def _touch(link):
    sid = link.get('job_id') or link.get('quote_id')
    for pk in ('LINK', 'JLINK#' + sid):
        table().update_item(Key={'pk': link_pk(pk), 'sk': link['secret']}, UpdateExpression='ADD #v :one', ExpressionAttributeNames={'#v': 'views'}, ExpressionAttributeValues={':one': 1})


def _gone(source):
    throttle(source, failed=True)
    raise missing('Not found')


def view(token, source):
    from . import workshop
    from .quotes import one as quote_one
    throttle(source)
    link = open_link(token, source)
    shop = workshop.business()
    if link.get('quote_id'):
        try:
            q = quote_one(link['quote_id'])
        except ApiError:
            _gone(source)
        if q['status'] == 'CONVERTED' and q.get('job_id'):   # the estimate became a job: the same link now follows the job
            link = dict(link, job_id=q['job_id'])
        else:
            _touch(link)
            return _quote_page(q, link, shop)
    j = workshop.job(link['job_id'])
    if j['status'] == 'ARCHIVED':
        _gone(source)
    v = workshop.view(j, shop['tax_rate'])
    out = {'kind': 'job', 'shop': _shop_card(shop),
           'job': {'job_no': v.get('job_no', ''), 'registration': v['registration'], 'vehicle': v.get('vehicle', ''), 'summary': v.get('summary', ''), 'status': v['status'],
                   'stage': v.get('stage') if v.get('stage') in STAGES else 'WAITING', 'created_at': v['created_at'], 'customer': v.get('customer', '')},
           'work': {'parts': [{'name': p['name'], 'quantity': p['quantity'], 'amount': workshop.line_total(p)} for p in v.get('parts', [])],
                    'labour': [{'description': l['description'], 'amount': l['amount']} for l in v.get('labour', [])],
                    'discount': v.get('discount', 0), 'total': v['total']},
           'photos': photo_groups(j['id']), 'invoice': None, 'expires': link['expires']}
    if j.get('invoice_id'):
        i = workshop.invoice(j['invoice_id'])
        if i['status'] != 'VOID':
            out['invoice'] = {'number': i['invoice_number'], 'status': i['status'], 'total': i['total'], 'paid': i['paid'], 'balance': i['total'] - i['paid'],
                              'created_at': i['created_at'], 'bank': shop.get('bank') or '', 'qr_url': shop.get('qr_url') or ''}
            out['work']['total'] = i['total']
    _touch(link)
    return out


def link_pk(pk):
    from .core import tpk
    return tpk(pk)


def decide(token, body, source):
    """The customer's answer to an estimate: Approve or Decline, with their name. Only a sent, unanswered estimate takes an answer, once."""
    from . import quotes
    throttle(source)
    link = open_link(token, source)
    if not link.get('quote_id'):
        _gone(source)
    decision = (body or {}).get('decision')
    name = ' '.join(str((body or {}).get('name') or '').split())
    if decision not in ('APPROVE', 'DECLINE'):
        raise bad('Choose Approve or Decline')
    if not 2 <= len(name) <= 60:
        raise bad('Please type your name')
    return quotes.decide(link['quote_id'], decision, name)


def photo(token, pid, source):
    throttle(source)
    link = open_link(token, source)
    if link.get('quote_id'):
        from .quotes import one
        try:
            q = one(link['quote_id'])
        except ApiError:
            _gone(source)
        allowed = set(q.get('photos') or [])
        if q['status'] == 'CONVERTED' and q.get('job_id'):
            allowed |= {p for v in photo_groups(q['job_id']).values() for p in v}
    else:
        allowed = {p for v in photo_groups(link['job_id']).values() for p in v}
    if pid not in allowed:  # only this job's own photos, never another one's
        _gone(source)
    return photos.read(pid, 'thumb')
