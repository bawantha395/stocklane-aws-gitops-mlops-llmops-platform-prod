"""The message centre: who should be sent a WhatsApp message today, and a log of what was done about it.

Nothing is sent from here. Each day the rules below look at jobs, bills, vehicles and customers and list who needs a message and why; the person
presses WhatsApp (the phone opens the chat with the words filled in), then marks it Sent, Skip or Later. That choice is the log, and it is how the
same message is never offered twice:

  WMSG/<type>#<ref>   one row per message dealt with: status SENT / SKIPPED / LATER (+ later_until), who, when

A `ref` names the occasion, so each rule repeats only when it should: a ready car once, a bill reminder once a week, a birthday once a year.
One customer with two things to hear today is one row. A customer who asked for no messages (customer flag) or has no phone is never sent to.
"""
import re
from datetime import date, timedelta

from .core import bad, command, get, now, put, query
from . import customers
from .customers import canon

TYPES = ('READY', 'PAYMENT', 'SERVICE', 'THANKS', 'BIRTHDAY', 'WINBACK')
STATUSES = ('SENT', 'SKIPPED', 'LATER')
WINBACK_FROM, WINBACK_TO = 180, 730   # not seen for 6 months; after two years it is left alone
THANKS_DAYS = 2
MAX_LOG = 20
MAX_TEXT = 600
VARIABLES = ('name', 'shop', 'vehicle', 'bill', 'amount', 'date', 'review', 'link')
ORIGIN = re.compile(r'https://[a-z0-9.-]{3,100}')
KEEP_DAYS = 400


DEFAULTS = {
    'READY': {'en': 'Hello {name}, your vehicle {vehicle} is ready for collection. {link} - {shop}',
              'si': 'ආයුබෝවන් {name}, ඔබේ {vehicle} වාහනය රැගෙන යාමට සූදානම්. {link} - {shop}'},
    'SERVICE': {'en': 'Hello {name}, {vehicle} is due for its service {date}. Call us to book. - {shop}',
                'si': 'ආයුබෝවන් {name}, {vehicle} වාහනයේ සේවාව {date} කල් ඉකුත් වේ. වෙන්කරගැනීමට අමතන්න. - {shop}'},
    'PAYMENT': {'en': 'Hello {name}, a gentle reminder: bill {bill}, LKR {amount}, is still to be paid. {link} - {shop}',
                'si': 'ආයුබෝවන් {name}, මතක් කිරීමක්: {bill} බිල්පත, රු. {amount}, තවමත් ගෙවා නැත. {link} - {shop}'},
    'THANKS': {'en': 'Hello {name}, thank you for choosing {shop}. {review}',
               'si': 'ආයුබෝවන් {name}, {shop} තෝරාගත් ඔබට ස්තූතියි. {review}'},
    'BIRTHDAY': {'en': 'Happy birthday {name}! Wishing you a wonderful year. - {shop}',
                 'si': 'සුභ උපන්දිනයක් {name}! ඔබට සුභ අනාගතයක් ප්‍රාර්ථනා කරමු. - {shop}'},
    'WINBACK': {'en': 'Hello {name}, it has been a while since we saw {vehicle}. Bring it in for a check. - {shop}',
                'si': 'ආයුබෝවන් {name}, {vehicle} අපිට දැක ගන්න ලැබිලා බොහෝ කල්. පරීක්ෂාවට රැගෙන එන්න. - {shop}'},
}


def templates():
    """What the owner has written, filled in with the built-in words where nothing was changed."""
    mine = (get('WSET', 'msg_templates') or {}).get('items') or {}
    return {k: {l: (mine.get(k) or {}).get(l) or DEFAULTS[k][l] for l in ('en', 'si')} for k in TYPES}


def templates_view():
    mine = (get('WSET', 'msg_templates') or {}).get('items') or {}
    return {'templates': templates(), 'defaults': DEFAULTS, 'variables': list(VARIABLES), 'custom': {k: sorted((mine.get(k) or {}).keys()) for k in TYPES}}


def render(text, values):
    for k in VARIABLES:
        text = text.replace('{%s}' % k, str(values.get(k) or ''))
    return re.sub(r'\s+([.,!?])', r'\1', ' '.join(text.split()))


def save_templates(key, who, body):
    def build():
        items = (body or {}).get('templates')
        if not isinstance(items, dict):
            raise bad('Send the templates')
        out = {}
        for k, v in items.items():
            if k not in TYPES or not isinstance(v, dict):
                raise bad('Check the templates')
            for l, text in v.items():
                if l not in ('en', 'si') or not isinstance(text, str):
                    raise bad('Check the templates')
                text = text.strip()
                if len(text) > MAX_TEXT:
                    raise bad('A message can be at most %d characters' % MAX_TEXT)
                if text and text != DEFAULTS[k][l]:  # empty or unchanged means "use the built-in words"
                    out.setdefault(k, {})[l] = text
        return [put({'pk': 'WSET', 'sk': 'msg_templates', 'items': out, 'updated_by': who, 'updated_at': now()})], [None], {'saved': True}
    return command(key, 'message-templates', who, body, build)


def _who(c, job_or_bill=None):
    return (c or {}).get('name') or (job_or_bill or {}).get('customer') or ''


def _done():
    """(type, ref) pairs not to offer: dealt with, or put off until after today."""
    from .workshop import today
    day, out = today().isoformat(), set()
    for r in query('WMSG'):
        if r['status'] in ('SENT', 'SKIPPED') or (r['status'] == 'LATER' and (r.get('later_until') or '') > day):
            out.add((r['type'], r['ref']))
    return out


def candidates():
    from . import workshop
    day, shop = workshop.today(), workshop.business()
    cust = {c['id']: c for c in query('CUST') if not c.get('merged_into')}
    by_phone = {}
    for c in cust.values():
        for k in customers.numbers(c):
            by_phone[k] = c

    def find(cid, phone):
        return cust.get(cid) or by_phone.get(canon(phone))

    out = []

    def add(kind, ref, c, name, phone, vals, detail, reg='', job_id=''):
        if c and (not c.get('active', True) or c.get('no_messages')):
            return
        out.append({'type': kind, 'ref': ref, 'customer_id': (c or {}).get('id') or '', 'name': name or '', 'phone': canon(phone) or '', 'job_id': job_id, 'vars': dict(vals, name=name or ''), 'lang': (c or {}).get('lang') or 'en', 'detail': detail, 'registration': reg})

    last_visit = {}
    for j in query('WJOB'):
        if j['status'] == 'ARCHIVED':
            continue
        c = find(j.get('customer_id'), j.get('phone'))
        key = (c or {}).get('id') or canon(j.get('phone'))
        if key and j['status'] != 'CANCELLED':
            seen = workshop.local_date(j['created_at'])
            if key not in last_visit or seen > last_visit[key][0]:
                last_visit[key] = (seen, c, j)
        if j['status'] == 'OPEN' and j.get('stage') == 'READY':
            add('READY', j['id'], c, _who(c, j), j.get('phone'), {'vehicle': j.get('registration', '')}, j.get('registration', ''), j.get('registration', ''), j['id'])
    for v in workshop.service_due():
        c = find(v.get('customer_id'), v.get('phone'))
        when = v.get('next_service_date')
        add('SERVICE', '%s:%s' % (v.get('registration'), when or 'km%s' % v.get('next_service_km')), c, _who(c, {'customer': v.get('owner')}), v.get('phone'),
            {'vehicle': v.get('registration'), 'date': 'on ' + when if when else 'soon'}, v.get('registration', ''), v.get('registration', ''))
    for i in query('WINV'):
        i = workshop.settled(i)
        c = find(i.get('customer_id'), i.get('phone'))
        if i['status'] in ('UNPAID', 'PARTIAL'):
            late = workshop.overdue_days(i)
            if late > 0:
                add('PAYMENT', '%s:%d' % (i['id'], late // 7), c, _who(c, i), i.get('phone'),
                    {'bill': i['invoice_number'], 'amount': f"{i['total'] - i['paid']:,.2f}", 'vehicle': i.get('registration', '')}, i['invoice_number'], i.get('registration', ''), i.get('job_id', ''))
        elif i['status'] == 'PAID' and i.get('total') and i.get('payments'):
            at = max((p['at'] for p in i['payments'] if not p.get('refund')), default=None)
            if at and (day - workshop.local_date(at)).days <= THANKS_DAYS:
                add('THANKS', i['id'], c, _who(c, i), i.get('phone'), {'bill': i['invoice_number'], 'vehicle': i.get('registration', ''), 'review': ('We would love a review: ' + shop['qr_url']) if shop.get('qr_url') else ''}, i['invoice_number'], i.get('registration', ''))
    md = day.strftime('%m-%d')
    for c in cust.values():
        if c.get('birthday') and c['birthday'][-5:] == md:
            add('BIRTHDAY', '%s:%d' % (c['id'], day.year), c, c['name'], c.get('phone') or c.get('phone2'), {}, c['birthday'])
    for key, (seen, c, j) in last_visit.items():
        gone = (day - seen).days
        if WINBACK_FROM <= gone <= WINBACK_TO:
            add('WINBACK', '%s:%s' % (key, seen.isoformat()), c, _who(c, j), j.get('phone'), {'vehicle': j.get('registration') or 'your vehicle'}, '%d days' % gone, j.get('registration', ''))
    return out, shop


def _link(c, origin):
    """The customer's page for a ready vehicle or an unpaid bill (made on first use). Without a site address there is no link, and the line stays out."""
    if not origin or not ORIGIN.fullmatch(origin) or c['type'] not in ('READY', 'PAYMENT') or not c.get('job_id'):
        return ''
    from . import links
    try:
        return '%s/t/%s' % (origin, links.ensure(c['job_id'])['token'])
    except Exception:  # a missing job must never stop the list
        return ''


def rows(origin=''):
    """Today's list, one row per customer. A row with no phone is shown (so it can be skipped) but cannot be sent."""
    cands, shop = candidates()
    tpl, sinhala = templates(), bool(shop.get('sinhala'))
    done, groups = _done(), {}
    for c in cands:
        if (c['type'], c['ref']) in done:
            continue
        key = c['customer_id'] or c['phone'] or '%s:%s' % (c['type'], c['ref'])
        g = groups.setdefault(key, {'key': key, 'customer_id': c['customer_id'], 'name': c['name'], 'phone': c['phone'], 'lang': c['lang'], 'items': []})
        g['name'] = g['name'] or c['name']
        g['phone'] = g['phone'] or c['phone']
        g['items'].append({'type': c['type'], 'ref': c['ref'], 'detail': c['detail'], 'text': render(tpl[c['type']]['si' if sinhala and c['lang'] == 'si' else 'en'], dict(c['vars'], shop=shop['name'], link=_link(c, origin))), 'registration': c['registration']})
    out = []
    for g in groups.values():
        g['items'].sort(key=lambda x: TYPES.index(x['type']))
        g['message'] = '\n\n'.join(x.pop('text') for x in g['items'])
        g['types'] = [x['type'] for x in g['items']]
        out.append(g)
    out.sort(key=lambda g: (TYPES.index(g['types'][0]), g['name'].lower()))
    counts = {t: sum(1 for g in out if t in g['types']) for t in TYPES}
    return {'rows': out, 'count': len(out), 'counts': counts}


def history():
    """The latest 100 things dealt with: what, to whom, and who pressed it."""
    done = sorted(query('WMSG'), key=lambda r: r['at'], reverse=True)[:100]
    return [{k: r.get(k, '') for k in ('type', 'ref', 'status', 'by', 'at', 'name')} for r in done]


def count():
    return {'count': rows()['count']}  # no site address: counting never makes links


def log(key, who, body):
    """Mark messages Sent, Skipped or Later (Later hides them until tomorrow)."""
    def build():
        b = body or {}
        status, items = b.get('status'), b.get('items')
        if status not in STATUSES:
            raise bad('Choose Sent, Skip or Later')
        if not isinstance(items, list) or not items or len(items) > MAX_LOG:
            raise bad('Choose the messages')
        from .workshop import today
        at, tomorrow, ttl = now(), (today() + timedelta(days=1)).isoformat(), int(__import__('time').time()) + KEEP_DAYS * 86400
        ops = []
        for it in items:
            kind, ref = (it.get('type'), str(it.get('ref') or '')) if isinstance(it, dict) else (None, '')
            if kind not in TYPES or not ref or len(ref) > 120:
                raise bad('Check the messages')
            row = {'pk': 'WMSG', 'sk': kind + '#' + ref, 'type': kind, 'ref': ref, 'status': status, 'by': who, 'at': at, 'day': today().isoformat(), 'ttl': ttl, 'name': str(it.get('name') or '')[:80]}
            if status == 'LATER':
                row['later_until'] = tomorrow
            ops.append(put(row))
        return ops, [None] * len(ops), {'logged': len(ops), 'status': status}
    return command(key, 'message-log', who, body, build)
