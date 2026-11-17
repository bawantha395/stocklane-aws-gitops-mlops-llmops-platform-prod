"""The month on one page (PDF) for the owner: income, profit, top parts, who owes, what the shop owes, slow stock, and how many alerts fired."""
import re
from datetime import date, timedelta

from .core import bad


def month_range(value):
    from .workshop import today
    if not value:
        first = today().replace(day=1)
    else:
        if not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', str(value)):
            raise bad('Pick a month like 2026-11')
        first = date(int(value[:4]), int(value[5:]), 1)
    last = (first.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    return first, min(last, today())


def data(month=''):
    from . import alerts, payables, slowstock, workshop
    first, last = month_range(month)
    if first > workshop.today():
        raise bad('That month has not started')
    r = workshop.report(first.isoformat(), last.isoformat())
    inside = [a for a in alerts.found((workshop.today() - first).days + 1) if first.isoformat() <= workshop.local_date(a['at']).isoformat() <= last.isoformat()]
    counts = {}
    for a in inside:
        counts[a['type']] = counts.get(a['type'], 0) + 1
    slow = slowstock.slow()
    pay = payables.summary()
    return {'month': first.strftime('%Y-%m'), 'from': first.isoformat(), 'until': last.isoformat(), 'printed': workshop.today().isoformat(), 'report': r,
            'alerts': counts, 'alert_total': len(inside), 'slow': {'count': slow['count'], 'value': slow['value'], 'unknown_cost': slow['unknown_cost'], 'categories': slow['categories'][:5]},
            'payables': {'total': pay['total'], 'overdue': pay['overdue'], 'suppliers': pay['suppliers'][:8]}}


def pdf(month=''):
    from . import bills
    from .workshop import business
    d = data(month)
    return bills.monthly(d, business()), 'month-' + d['month']
