"""Optional: close the day (count the cash) and, if the shop wants it, lock closed days.

Both are shop switches in Settings and both are off until the owner turns them on:
  cash_up_on    shows the Cash-up screen: the system adds up what was taken today, the person counts the drawer, the difference
                is written down with who closed the day. A difference needs a short note.
  day_lock_on   (needs cash_up_on) a closed day cannot change: no payment or refund joins it, a bill of that day cannot be voided,
                and no part return is written into it. The owner can reopen a day (with a reason) and close it again.
Stock and cost corrections are not locked: they do not move money.

One row per day: WCASH/<yyyy-mm-dd>.
"""
from decimal import Decimal

from .core import bad, command, conflict, get, missing, now, put, query

ZERO = Decimal('0')


def _w():
    from . import workshop
    return workshop


def enabled():
    return _w().business().get('cash_up_on') is True


def locking():
    b = _w().business()
    return b.get('cash_up_on') is True and b.get('day_lock_on') is True


def guard(when_iso):
    """Refuse a money change that would land in a closed day (only when the shop locks closed days)."""
    if not locking():
        return
    d = _w().local_date(when_iso).isoformat()
    row = get('WCASH', d)
    if row and row.get('status') == 'CLOSED':
        raise conflict('%s is closed. The owner can reopen the day in Cash-up.' % d)


def taken(d):
    """What came in on one day, by way of payment (refunds are taken off)."""
    w = _w()
    by, count = {}, 0
    for i in w.winv():
        for p in i['payments']:
            if w.local_date(p['at']).isoformat() == d:
                by[p['method']] = by.get(p['method'], ZERO) + p['amount']
                count += 1
    return by, count


def _day(value):
    w = _w()
    d = w.day(value, 'Date') or w.today().isoformat()
    if d > w.today().isoformat():
        raise bad('That day has not come yet')
    return d


def view(d=''):
    if not enabled():
        raise missing('Cash-up is not turned on. The owner can turn it on in Settings')
    d = _day(d)
    by, count = taken(d)
    row = get('WCASH', d)
    return {'date': d, 'by_method': [{'method': k, 'amount': v} for k, v in sorted(by.items())], 'expected_cash': by.get('CASH', ZERO), 'payments': count,
            'row': row if row and row.get('status') == 'CLOSED' else None, 'was_reopened': bool(row and row.get('status') == 'REOPENED'),
            'locking': locking()}


def history():
    if not enabled():
        raise missing('Cash-up is not turned on. The owner can turn it on in Settings')
    rows = sorted(query('WCASH'), key=lambda r: r['date'], reverse=True)[:31]
    return [{k: r.get(k) for k in ('date', 'status', 'expected_cash', 'counted', 'variance', 'closed_by', 'closed_at', 'note', 'reopened_by', 'reopened_at', 'reopen_reason')} for r in rows]


def close(key, who, body):
    def build():
        if not enabled():
            raise missing('Cash-up is not turned on')
        w, b = _w(), body or {}
        d = _day(b.get('date'))
        counted = w.money(b.get('counted'), 'Cash counted')
        note = w.text(b.get('note'), 'Note', 200)
        old = get('WCASH', d)
        if old and old.get('status') == 'CLOSED':
            raise conflict('%s is already closed' % d)
        by, count = taken(d)
        expected = by.get('CASH', ZERO)
        variance = counted - expected
        if variance != 0 and not note:
            raise bad('The cash counted is not what the bills say. Write a short note about the difference')
        earlier = list((old or {}).get('earlier') or [])
        if old:
            earlier.append({k: old.get(k) for k in ('counted', 'variance', 'closed_by', 'closed_at', 'reopened_by', 'reopened_at', 'reopen_reason')})
        row = {'pk': 'WCASH', 'sk': d, 'date': d, 'status': 'CLOSED', 'expected_cash': expected, 'counted': counted, 'variance': variance, 'note': note,
               'by_method': {k: v for k, v in by.items()}, 'payments': count, 'closed_by': who, 'closed_at': now(), 'earlier': earlier[-10:],
               'revision': int((old or {}).get('revision') or 0) + 1}
        if old:
            op = put(row, ConditionExpression='revision = :r', ExpressionAttributeValues={':r': old['revision']})
        else:
            op = put(row, ConditionExpression='attribute_not_exists(sk)')
        return [op], ['Someone closed this day just now. Reload it.'], {k: row[k] for k in ('date', 'status', 'expected_cash', 'counted', 'variance', 'note', 'closed_by', 'closed_at')}
    return command(key, 'cashup-close', who, body, build)


def reopen(key, who, body):
    """Owner only. A closed day is opened again, with the reason kept on the row."""
    def build():
        w, b = _w(), body or {}
        d = _day(b.get('date'))
        reason = w.text(b.get('reason'), 'Reason', 200, True)
        old = get('WCASH', d)
        if not old or old.get('status') != 'CLOSED':
            raise conflict('%s is not closed' % d)
        row = dict(old, status='REOPENED', reopened_by=who, reopened_at=now(), reopen_reason=reason, revision=int(old['revision']) + 1)
        op = put(row, ConditionExpression='revision = :r', ExpressionAttributeValues={':r': old['revision']})
        return [op], ['Someone changed this day just now. Reload it.'], {'date': d, 'status': 'REOPENED'}
    return command(key, 'cashup-reopen', who, body, build)
