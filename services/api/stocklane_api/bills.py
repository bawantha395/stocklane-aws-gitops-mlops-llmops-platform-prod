"""Page layouts: the invoice, a vehicle's repair history and the workshop report."""
from decimal import Decimal

from .pdf import ACCENT, H, INK, LINE, MARGIN, MUTED, W, WASH, Doc, fit, width, wrap

R = W - MARGIN  # right edge
GREY = (0.93, 0.94, 0.93)


def m(v):
    return format(Decimal(str(v)), ',.2f')


def q(v):
    return format(Decimal(str(v)).normalize(), 'f')


def kms(v):
    return format(int(v), ',') + ' km'


def letterhead(d, business, title, lines):
    """Business name and contacts on the left, document title and facts on the right."""
    top = d.y
    d.text(MARGIN, top + 18, business.get('name') or 'Workshop', 18, True, color=ACCENT)
    y = top + 32
    for part in (business.get('address'), ' | '.join(x for x in (business.get('phone'), business.get('email')) if x), business.get('reg_no')):
        if part:
            for row in wrap(part, 300, 9):
                d.text(MARGIN, y + 8, row, 9, color=MUTED)
                y += 12
    d.text(R, top + 20, title, 20, True, 'r')
    ry = top + 36
    for text, bold in lines:
        d.text(R, ry + 8, text, 9.5, bold, 'r', color=INK if bold else MUTED)
        ry += 13
    d.y = max(y, ry) + 8
    d.line(MARGIN, d.y, R, d.y, 1.2, ACCENT)
    d.y += 14


def block(d, x, w, label, rows):
    d.text(x, d.y + 8, label, 8, True, color=MUTED)
    y = d.y + 22
    for text, size, bold in rows:
        if text:
            for part in wrap(text, w, size, bold):
                d.text(x, y + size * 0.8, part, size, bold)
                y += size * 1.4
    return y


def columns(d, cols, labels):
    d.rect(MARGIN, d.y, R - MARGIN, 18, GREY)
    for (x, align), label in zip(cols, labels):
        d.text(x, d.y + 12.5, label, 8.5, True, align)
    d.y += 18


def invoice(i):
    b = i.get('business') or {}
    d = Doc(footer=(b.get('name') or 'Workshop') + ' | ' + i['invoice_number'])
    status = i['status']
    letterhead(d, b, 'VOID' if status == 'VOID' else 'INVOICE' if not b.get('tax_rate') else 'TAX INVOICE', [
        (i['invoice_number'], True), ('Date: ' + i['date'], False), ('Status: ' + {'UNPAID': 'Unpaid', 'PARTIAL': 'Part paid', 'PAID': 'Paid', 'VOID': 'Void'}[status], False)])
    left = block(d, MARGIN, 230, 'BILL TO', [(i['customer'], 11, True), (i.get('phone'), 9.5, False)])
    odo = kms(i['odometer']) if i.get('odometer') is not None else ''
    right = block(d, 320, 235, 'VEHICLE', [(i['registration'], 13, True), (i.get('vehicle'), 9.5, False), (odo, 9.5, False),
                                          ('Mechanic: ' + i['mechanic'] if i.get('mechanic') else '', 9.5, False)])
    d.y = max(left, right) + 6
    if i.get('summary'):
        d.text(MARGIN, d.y + 8, 'WORK REQUESTED', 8, True, color=MUTED)
        d.y += 14
        d.paragraph(MARGIN, i['summary'], R - MARGIN, 9.5)
        d.y += 6
    cols = [(MARGIN + 6, 'l'), (MARGIN + 34, 'l'), (330, 'r'), (415, 'r'), (R - 6, 'r')]
    labels = ['#', 'DESCRIPTION', 'QTY', 'UNIT PRICE', 'AMOUNT (' + i['currency'] + ')']

    def rows(title, items):
        if not items:
            return
        d.room(60)
        columns(d, cols, [''] + [title] + labels[2:]) if False else None
        d.rect(MARGIN, d.y, R - MARGIN, 18, GREY)
        d.text(cols[0][0], d.y + 12.5, '#', 8.5, True)
        d.text(cols[1][0], d.y + 12.5, title, 8.5, True)
        for (x, align), label in zip(cols[2:], labels[2:]):
            d.text(x, d.y + 12.5, label if title == 'PARTS' or label == labels[4] else '', 8.5, True, align)
        d.y += 18
        for n, row in enumerate(items, 1):
            lines = wrap(row['name'], 270, 9.5)
            h = max(20, len(lines) * 13 + 8)
            if d.room(h):
                pass
            d.text(cols[0][0], d.y + 14, str(n), 9.5, color=MUTED)
            for k, part in enumerate(lines):
                d.text(cols[1][0], d.y + 14 + k * 13, part, 9.5)
            if row.get('qty') is not None:
                d.text(cols[2][0], d.y + 14, q(row['qty']), 9.5, align='r')
                d.text(cols[3][0], d.y + 14, m(row['price']), 9.5, align='r')
            d.text(cols[4][0], d.y + 14, m(row['amount']), 9.5, align='r')
            d.y += h
            d.line(MARGIN, d.y, R, d.y)
        d.y += 8

    rows('PARTS', [{'name': p['name'], 'qty': p['quantity'], 'price': p['unit_price'], 'amount': p['amount']} for p in i['parts']])
    rows('LABOUR', [{'name': l['description'], 'amount': l['amount']} for l in i['labour']])

    # totals, right-aligned block
    lines = [('Parts', m(i['parts_total'])), ('Labour', m(i['labour_total']))]
    if i['discount']:
        lines.append(('Discount', '-' + m(i['discount'])))
    if i['tax']:
        lines.append((i['tax_name'] + ' (' + q(i['tax_rate']) + '%)', m(i['tax'])))
    d.room(30 + 16 * len(lines) + 70)
    for label, value in lines:
        d.text(430, d.y + 10, label, 9.5, color=MUTED, align='r')
        d.text(R - 6, d.y + 10, value, 9.5, align='r')
        d.y += 16
    d.rect(300, d.y + 2, R - 300, 26, ACCENT)
    d.text(310, d.y + 19, 'TOTAL (' + i['currency'] + ')', 10, True, color=(1, 1, 1))
    d.text(R - 6, d.y + 19, m(i['total']), 12, True, 'r', color=(1, 1, 1))
    d.y += 36
    if i['paid']:
        d.text(430, d.y + 8, 'Paid', 9.5, color=MUTED, align='r')
        d.text(R - 6, d.y + 8, m(i['paid']), 9.5, align='r')
        d.y += 16
    balance = Decimal(str(i['total'])) - Decimal(str(i['paid']))
    if status != 'VOID':
        d.text(430, d.y + 10, 'Balance due', 10, True, align='r')
        d.text(R - 6, d.y + 10, m(balance), 11, True, 'r')
        d.y += 22
    if i['payments']:
        d.room(40 + 14 * len(i['payments']))
        d.text(MARGIN, d.y + 8, 'PAYMENTS RECEIVED', 8, True, color=MUTED)
        d.y += 14
        for p in i['payments']:
            d.text(MARGIN, d.y + 9, p['date'] + '   ' + p['method'].title() + (('   ' + p['note']) if p['note'] else ''), 9, color=INK)
            d.text(R - 6, d.y + 9, m(p['amount']), 9, align='r')
            d.y += 14
        d.y += 6
    if i.get('next_service_date') or i.get('next_service_km'):
        d.room(40)
        d.rect(MARGIN, d.y, R - MARGIN, 26, WASH)
        what = ' and '.join(x for x in (i.get('next_service_date') and 'on ' + i['next_service_date'], i.get('next_service_km') and 'at ' + kms(i['next_service_km'])) if x)
        d.text(MARGIN + 10, d.y + 17, 'Next service due ' + what, 9.5, True, color=ACCENT)
        d.y += 36
    if b.get('bank') or b.get('footer'):
        d.room(60)
        if b.get('bank'):
            d.text(MARGIN, d.y + 8, 'PAYMENT DETAILS', 8, True, color=MUTED)
            d.y += 14
            d.paragraph(MARGIN, b['bank'], 300, 9)
            d.y += 4
        if b.get('footer'):
            d.paragraph(MARGIN, b['footer'], R - MARGIN, 9, color=MUTED)
    d.room(50)
    d.y = max(d.y + 24, H - MARGIN - 50) if len(d.pages) == 1 and d.y < H - MARGIN - 80 else d.y + 24
    d.line(R - 170, d.y, R, d.y)
    d.text(R, d.y + 12, 'Authorised signature', 8.5, align='r', color=MUTED)
    return d.render()


def history(v, visits, business):
    """v: vehicle file; visits: list of job dicts (newest first) each with 'date', 'lines' and totals."""
    d = Doc(footer=(business.get('name') or 'Workshop') + ' | ' + v['registration'] + ' | repair history')
    letterhead(d, business, 'REPAIR HISTORY', [(v['registration'], True), ('Printed: ' + v['printed'], False)])
    left = block(d, MARGIN, 250, 'OWNER', [(v.get('owner', ''), 11, True), (v.get('phone'), 9.5, False)])
    facts = [('Vehicle', v.get('make') or '-'), ('Last odometer', kms(v['last_km']) if v.get('last_km') is not None else '-'),
             ('Visits', str(v['visits'])), ('Total invoiced (' + v['currency'] + ')', m(v['spent']))]
    if v.get('next_service_date') or v.get('next_service_km'):
        facts.append(('Next service', ' / '.join(x for x in (v.get('next_service_date'), v.get('next_service_km') and kms(v['next_service_km'])) if x)))
    y = d.y + 2
    for label, value in facts:
        d.text(330, y + 10, label, 9, color=MUTED)
        d.text(R, y + 10, value, 9.5, True, 'r')
        y += 15
    d.y = max(left, y) + 8
    for j in visits:
        need = 60 + 13 * (len(j['lines']) + 1)
        d.room(min(need, 200))
        d.rect(MARGIN, d.y, R - MARGIN, 22, GREY)
        bits = [j['date']] + ([kms(j['odometer'])] if j.get('odometer') is not None else []) + ([j['invoice_number']] if j.get('invoice_number') else [])
        d.text(MARGIN + 8, d.y + 15, '  |  '.join(bits), 9.5, True)
        d.text(R - 8, d.y + 15, ('CANCELLED' if j['status'] == 'CANCELLED' else 'Open' if j['status'] == 'OPEN' else m(j['total'])), 9.5, True, 'r')
        d.y += 28
        if j.get('summary'):
            d.paragraph(MARGIN + 8, j['summary'], R - MARGIN - 16, 9.5, bold=False)
        for kind, label, amount in j['lines']:
            d.room(14)
            d.text(MARGIN + 14, d.y + 9, ('' if kind == 'part' else 'Labour: ') + fit(label, 360, 9), 9, color=MUTED if kind == 'labour' else INK)
            d.text(R - 8, d.y + 9, m(amount), 9, align='r')
            d.y += 13
        d.y += 10
    if not visits:
        d.text(MARGIN, d.y + 12, 'No repairs recorded yet.', 10, color=MUTED)
    return d.render()


def bars(d, x, y, w, h, data, label_every):
    """Daily revenue columns (one series, one colour, hairline baseline). data: [(label, value)]."""
    top = max([float(v) for _, v in data] + [1.0])
    d.line(x, y + h, x + w, y + h, 0.8, MUTED)
    slot = w / max(len(data), 1)
    bar = max(2.0, min(14.0, slot * 0.6))
    for k, (label, value) in enumerate(data):
        bh = (float(value) / top) * (h - 10)
        if bh > 0.2:
            d.rect(x + k * slot + (slot - bar) / 2, y + h - bh, bar, bh, ACCENT)
        if k % label_every == 0:
            d.text(x + k * slot + slot / 2, y + h + 11, label, 7, align='c', color=MUTED)
    d.text(x, y + 6, 'max ' + m(top), 7.5, color=MUTED)


def report(r, business):
    d = Doc(footer=(business.get('name') or 'Workshop') + ' | workshop report')
    letterhead(d, business, 'WORKSHOP REPORT', [(r['from'] + '  to  ' + r['until'], True), ('Printed: ' + r['printed'], False)])
    cards = [('Billed', m(r['total'])), ('Received', m(r['received'])), ('Unpaid (all time)', m(r['outstanding_all_time'])), ('Invoices', str(r['invoices'])),
             ('Vehicles', str(r['vehicles'])), ('Average invoice', m(r['average'])), ('Parts', m(r['parts_total'])), ('Labour', m(r['labour_total']))]
    cw = (R - MARGIN - 3 * 8) / 4
    for k, (label, value) in enumerate(cards):
        x, y = MARGIN + (k % 4) * (cw + 8), d.y + (k // 4) * 52
        d.rect(x, y, cw, 44, WASH)
        d.text(x + 8, y + 15, label, 8, color=MUTED)
        d.text(x + 8, y + 34, value, 13, True)
    d.y += 112
    if r['by_day']:
        d.text(MARGIN, d.y + 8, 'BILLED PER DAY (' + r['currency'] + ')', 8, True, color=MUTED)
        d.y += 14
        data = [(x['date'][5:], x['billed']) for x in r['by_day']]
        bars(d, MARGIN, d.y, R - MARGIN, 90, data, max(1, len(data) // 12))
        d.y += 118

    def table(title, heads, rows_, aligns, xs):
        if not rows_:
            return
        d.room(50)
        d.text(MARGIN, d.y + 8, title, 8, True, color=MUTED)
        d.y += 14
        d.rect(MARGIN, d.y, R - MARGIN, 17, GREY)
        for h, a, x in zip(heads, aligns, xs):
            d.text(x, d.y + 12, h, 8, True, a)
        d.y += 17
        for row in rows_:
            d.room(16)
            for cell, a, x in zip(row, aligns, xs):
                d.text(x, d.y + 12, fit(cell, 240 if a == 'l' else 100, 9), 9, align=a)
            d.y += 16
            d.line(MARGIN, d.y, R, d.y)
        d.y += 12

    table('BY MECHANIC', ['MECHANIC', 'JOBS', 'BILLED'], [(x['mechanic'], str(x['jobs']), m(x['total'])) for x in r['by_mechanic']], ['l', 'r', 'r'], [MARGIN + 6, 400, R - 6])
    table('PAYMENTS RECEIVED BY METHOD', ['METHOD', 'AMOUNT'], [(x['method'].title(), m(x['amount'])) for x in r['by_method']], ['l', 'r'], [MARGIN + 6, R - 6])
    table('TOP PARTS', ['PART', 'QTY', 'AMOUNT'], [(x['name'], q(x['quantity']), m(x['amount'])) for x in r['top_parts']], ['l', 'r', 'r'], [MARGIN + 6, 400, R - 6])
    table('TOP LABOUR', ['WORK', 'TIMES', 'AMOUNT'], [(x['name'], str(x['times']), m(x['amount'])) for x in r['top_labour']], ['l', 'r', 'r'], [MARGIN + 6, 400, R - 6])
    ag = r['ageing']
    table('UNPAID BY AGE (ALL TIME)', ['AGE', 'AMOUNT'], [('0 - 7 days', m(ag['d0_7'])), ('8 - 30 days', m(ag['d8_30'])), ('31 - 60 days', m(ag['d31_60'])), ('Over 60 days', m(ag['d60_plus']))], ['l', 'r'], [MARGIN + 6, R - 6])
    table('UNPAID INVOICES', ['INVOICE', 'VEHICLE', 'DAYS', 'BALANCE'], [(x['invoice_number'], x['registration'] + ' ' + x['customer'], str(x['days']), m(x['balance'])) for x in r['unpaid_list']],
          ['l', 'l', 'r', 'r'], [MARGIN + 6, 190, 440, R - 6])
    return d.render()
