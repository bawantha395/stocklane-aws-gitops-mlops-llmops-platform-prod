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


def shop_logo(business):
    """(jpeg bytes, width, height, components) for the letterhead, from the bill's own header or else the shop's current logo; None when there is none."""
    from . import photos
    from .core import get
    for meta in ((business or {}).get('logo'), (get('WSET', 'business') or {}).get('logo')):
        raw = photos.logo_bytes((meta or {}).get('v'))
        if raw:
            return raw, int(meta['w']), int(meta['h']), int(meta.get('c', 3))
    return None


def letterhead(d, business, title, lines):
    """Brand band, monogram tile and business name on the left, document title and facts on the right."""
    top = d.y
    name = business.get('name') or 'Workshop'
    d.rect(0, 0, W, 9, ACCENT)
    logo = shop_logo(business)
    if logo:
        raw, iw, ih, comps = logo
        lw, lh = min(96.0, 42.0 * iw / ih), 42.0
        lw, lh = (lw, lw * ih / iw) if lw < 42.0 * iw / ih else (lw, lh)
        d.image(MARGIN, top + 1, lw, lh, raw, iw, ih, comps)
        x0 = MARGIN + lw + 12
    else:
        initials = ''.join(w[0] for w in name.split()[:2]).upper() or '-'
        d.rect(MARGIN, top + 2, 40, 40, ACCENT)
        d.text(MARGIN + 20 - width(initials, 16, True) / 2, top + 28, initials, 16, True, color=(1, 1, 1))
        x0 = MARGIN + 52
    d.text(x0, top + 18, name, 18, True, color=ACCENT)
    y = top + 32
    for part in (business.get('address'), ' | '.join(x for x in (business.get('phone'), business.get('email')) if x), business.get('reg_no')):
        if part:
            for row in wrap(part, 280, 9):
                d.text(x0, y + 8, row, 9, color=MUTED)
                y += 12
    d.text(R, top + 20, title, 20, True, 'r', color=ACCENT)
    ry = top + 36
    for text, bold in lines:
        d.text(R, ry + 8, text, 9.5, bold, 'r', color=INK if bold else MUTED)
        ry += 13
    d.y = max(y, ry, top + 46) + 8
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


def work_warranty(i):
    """The warranty given on this job's work, as one sentence (empty when there is none)."""
    until, limit = i.get('warranty_until'), i.get('warranty_km')
    parts = (['until ' + until] if until else []) + ([kms(limit)] if limit else [])
    text = ('Covered ' + ' or '.join(parts) + (', whichever comes first.' if len(parts) == 2 else '.')) if parts else ''
    return (text + (' ' if text else '') + 'This is a warranty / redo job.') if i.get('warranty_job') else text


def invoice(i):
    b = i.get('business') or {}
    d = Doc(footer=(b.get('name') or 'Workshop') + ' | ' + i['invoice_number'])
    status = i['status']
    letterhead(d, b, 'VOID' if status == 'VOID' else 'INVOICE' if not b.get('tax_rate') else 'TAX INVOICE',
        [(i['invoice_number'], True), ('Date: ' + i['date'], False)]
        + ([('Due: ' + i['due_date'] + ' (' + str(i['terms']) + ' days)', False)] if i.get('due_date') else [])
        + [('Status: ' + {'UNPAID': 'Unpaid', 'PARTIAL': 'Part paid', 'PAID': 'Paid', 'REFUNDED': 'Refunded', 'VOID': 'Void'}[status], False)])
    left = block(d, MARGIN, 230, 'BILL TO', [(i['customer'], 11, True), (i.get('address'), 9.5, False), (i.get('phone'), 9.5, False),
                                         (('Brought in by: ' + i['brought_by'] + ((' ' + i['brought_phone']) if i.get('brought_phone') else '')) if i.get('brought_by') else '', 9, False)])
    odo = kms(i['odometer']) if i.get('odometer') is not None else ''
    right = block(d, 320, 235, 'VEHICLE', [(i['registration'], 13, True), (i.get('vehicle'), 9.5, False), (odo, 9.5, False),
                                          ('Mechanic: ' + i['mechanic'] if i.get('mechanic') else '', 9.5, False),
                                          (' | '.join(x for x in (i.get('job_no') and 'Job: ' + i['job_no'], i.get('invoice_type') and i['invoice_type'].title() + ' bill') if x), 9.5, False),
                                          ('Chassis: ' + i['chassis'] if i.get('chassis') else '', 9.5, False)])
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
            h = max(20, len(lines) * 13 + 8 + (10 if row.get('sub') else 0))
            if d.room(h):
                pass
            d.text(cols[0][0], d.y + 14, str(n), 9.5, color=MUTED)
            for k, part in enumerate(lines):
                d.text(cols[1][0], d.y + 14 + k * 13, part, 9.5)
            if row.get('sub'):
                d.text(cols[1][0], d.y + 14 + len(lines) * 13 - 1, row['sub'], 7.5, color=MUTED)
            if row.get('qty') is not None:
                d.text(cols[2][0], d.y + 14, q(row['qty']), 9.5, align='r')
                d.text(cols[3][0], d.y + 14, m(row['price']), 9.5, align='r')
            d.text(cols[4][0], d.y + 14, m(row['amount']), 9.5, align='r')
            d.y += h
            d.line(MARGIN, d.y, R, d.y)
        d.y += 8

    rows('PARTS', [{'name': p['name'] + (' (' + q(p['discount_pct']) + '% off)' if p.get('discount_pct') else ''), 'qty': p['quantity'], 'price': p['unit_price'], 'amount': p['amount'], 'sub': ('Part No: ' + p['part_no']) if p.get('part_no') else ''} for p in i['parts']])
    rows('LABOUR', [{'name': l['description'], 'amount': l['amount']} for l in i['labour']])

    # totals, right-aligned block
    tot_page, tot_y = len(d.pages), d.y
    lines = [('Parts', m(i['parts_total'])), ('Labour', m(i['labour_total']))]
    if i['discount']:
        lines.append(('Discount', '-' + m(i['discount'])))
    if i['tax']:
        lines.append((i['tax_name'] + ' (' + q(i['tax_rate']) + '%)', m(i['tax'])))
    if i.get('credit_total'):
        lines.append(('Returned parts credit', '-' + m(i['credit_total'])))
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
        d.text(MARGIN, d.y + 8, 'PAYMENTS AND REFUNDS' if any(p.get('refund') for p in i['payments']) else 'PAYMENTS RECEIVED', 8, True, color=MUTED)
        d.y += 14
        for p in i['payments']:
            d.text(MARGIN, d.y + 9, p.get('date', '') + '   ' + str(p.get('method') or '').title() + (('   ' + p['note']) if p.get('note') else ''), 9, color=INK)
            d.text(R - 6, d.y + 9, m(p['amount']), 9, align='r')
            d.y += 14
        d.y += 6
    if i.get('next_service_date') or i.get('next_service_km'):
        d.room(40)
        d.rect(MARGIN, d.y, R - MARGIN, 26, WASH)
        what = ' and '.join(x for x in (i.get('next_service_date') and 'on ' + i['next_service_date'], i.get('next_service_km') and 'at ' + kms(i['next_service_km'])) if x)
        d.text(MARGIN + 10, d.y + 17, 'Next service due ' + what, 9.5, True, color=ACCENT)
        d.y += 36
    if not i.get('tax_rate') and not b.get('tax_rate') and not b.get('reg_no'):
        d.room(24)
        d.text(MARGIN, d.y + 10, 'This is not a tax invoice.', 9, True, color=MUTED)
        d.y += 20
    qr = b.get('qr_bits') if b.get('qr_url') else ''
    if b.get('bank') or qr:
        rows = []
        for part in (b.get('bank') or '').split('\n'):
            rows += wrap(part, 300, 9.5) if part else []
        box = max(84 if qr else 0, 30 + 13 * len(rows))
        d.room(box + 10)
        d.rect(MARGIN, d.y, R - MARGIN if qr else 330, box, WASH)
        d.rect(MARGIN, d.y, 4, box, ACCENT)
        d.text(MARGIN + 14, d.y + 15, 'HOW TO PAY', 8, True, color=ACCENT)
        for k, row in enumerate(rows):
            d.text(MARGIN + 14, d.y + 30 + k * 13, row, 9.5, k == 0)
        if qr:
            d.qr(R - 76, d.y + 8, 64, qr)
            d.text(R - 44, d.y + box - 2, 'Scan', 7, color=MUTED, align='c')
        d.y += box + 10
    note = work_warranty(i)
    if note:
        d.room(30)
        d.text(MARGIN, d.y + 9, 'WARRANTY ON THIS WORK', 8, True, color=MUTED)
        d.y += 14
        d.paragraph(MARGIN, note, R - MARGIN, 9)
        d.y += 4
    if b.get('warranty'):
        d.room(30)
        d.text(MARGIN, d.y + 9, 'WARRANTY', 8, True, color=MUTED)
        d.y += 14
        d.paragraph(MARGIN, b['warranty'], R - MARGIN, 9)
        d.y += 4
    if b.get('footer'):
        d.room(30)
        d.paragraph(MARGIN, b['footer'], R - MARGIN, 9, color=MUTED)
    stamp_y = d.y
    d.room(50)
    d.y = max(d.y + 24, H - MARGIN - 50) if len(d.pages) == 1 and d.y < H - MARGIN - 80 else d.y + 24
    d.line(R - 170, d.y, R, d.y)
    d.text(R, d.y + 12, 'Authorised signature', 8.5, align='r', color=MUTED)
    if status in ('PAID', 'VOID', 'REFUNDED'):
        for n in range(len(d.pages)):
            if status == 'REFUNDED':
                d.watermark('REFUNDED', (0.9, 0.78, 0.7), n, size=70)
            else:
                d.watermark('PAID' if status == 'PAID' else 'VOID', (0.77, 0.75, 0.92) if status == 'PAID' else (0.8, 0.8, 0.82), n)
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
    changes = v.get('owner_log') or []
    names = {j.get('customer') for j in visits if j.get('customer')}
    many = bool(changes) or len(names) > 1
    if changes:
        d.room(16 + 12 * len(changes))
        d.text(MARGIN, d.y + 9, 'OWNERSHIP CHANGES', 8, True, color=MUTED)
        d.y += 14
        for c in changes:
            d.text(MARGIN + 8, d.y + 9, (c.get('at') or '')[:10] + '   ' + fit(c.get('from_owner') or '-', 150, 9) + '  ->  ' + fit(c.get('to_owner') or '-', 150, 9), 9)
            d.y += 12
        d.y += 8
    for j in visits:
        need = 84 + 13 * (len(j['lines']) + 1)
        d.room(min(need, 220))
        d.rect(MARGIN, d.y, R - MARGIN, 22, GREY)
        bits = [j['date']] + ([j['job_no']] if j.get('job_no') else []) + ([kms(j['odometer'])] if j.get('odometer') is not None else []) + ([j['invoice_number']] if j.get('invoice_number') else [])
        d.text(MARGIN + 8, d.y + 15, '  |  '.join(bits), 9.5, True)
        d.text(R - 8, d.y + 15, ('CANCELLED' if j['status'] == 'CANCELLED' else 'Open' if j['status'] == 'OPEN' else m(j['total'])), 9.5, True, 'r')
        d.y += 28
        if j.get('pay_status') and j['status'] == 'INVOICED':
            if j['pay_status'] == 'PAID':
                note = 'PAID'
            elif j['pay_status'] == 'REFUNDED':
                note = 'REFUNDED  |  Money returned to the customer'
            else:
                note = ('PART PAID' if j['pay_status'] == 'PARTIAL' else 'NOT PAID') + '  |  Paid ' + m(j['paid']) + '  |  Balance ' + m(j['balance'])
            d.text(R - 8, d.y + 1, note, 8.5, True, 'r', color=MUTED if j['pay_status'] in ('PAID', 'REFUNDED') else INK)
            d.y += 11
        if many and j.get('customer'):
            d.text(MARGIN + 8, d.y + 9, 'Owner: ' + fit(j['customer'], 300, 9), 9, color=MUTED)
            d.y += 12
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


def stock_report(r, business):
    """Stock movement per item between two dates: opening, came in, went out, returned, count corrections, closing."""
    d = Doc(footer=(business.get('name') or 'Workshop') + ' | stock movement report')
    letterhead(d, business, 'STOCK MOVEMENT', [(r['from'] + '  to  ' + r['until'], True), ('Printed: ' + r['printed'], False)])
    rows = r['rows']
    tot = lambda k: sum((Decimal(str(x[k])) for x in rows), Decimal(0))
    cards = [('Items that moved', str(len(rows))), ('Came in', q(tot('came_in_quantity'))), ('Went out', q(tot('taken_quantity'))), ('Returned', q(tot('returned_quantity')))]
    cw = (R - MARGIN - 3 * 8) / 4
    for k, (label, value) in enumerate(cards):
        x = MARGIN + k * (cw + 8)
        d.rect(x, d.y, cw, 44, WASH)
        d.text(x + 8, d.y + 15, label, 8, color=MUTED)
        d.text(x + 8, d.y + 34, value, 13, True)
    d.y += 56
    note = 'Came in = bought / received stock and opening stock. Went out = used on jobs and handed over at the counter. Returned = parts taken back into stock. Count = corrections after a shelf count.'
    d.paragraph(MARGIN, note, R - MARGIN, 8, bold=False)
    d.y += 6
    xs = [R - 6 - 54 * k for k in range(5, -1, -1)]
    heads = ['OPENING', 'CAME IN', 'WENT OUT', 'RETURNED', 'COUNT', 'CLOSING']

    def head():
        d.rect(MARGIN, d.y, R - MARGIN, 17, GREY)
        d.text(MARGIN + 6, d.y + 12, 'ITEM', 8, True)
        for h, x in zip(heads, xs):
            d.text(x, d.y + 12, h, 8, True, 'r')
        d.y += 17

    def cell(v):
        v = Decimal(str(v))
        return '-' if v == 0 else q(v)
    head()
    for x in rows:
        if d.room(30):
            head()
        d.text(MARGIN + 6, d.y + 11, fit(x['name'], 190, 9), 9)
        d.text(MARGIN + 6, d.y + 21, fit((x['sku'] or '') + (' | ' + x['location'] if x.get('location') else ''), 190, 7.5), 7.5, color=MUTED)
        vals = [x['opening_quantity'], x['came_in_quantity'], x['taken_quantity'], x['returned_quantity'], x['adjusted_quantity'], x['closing_quantity']]
        for v, px in zip(vals, xs):
            d.text(px, d.y + 15, cell(v), 9, px == xs[-1], 'r')
        d.y += 26
        d.line(MARGIN, d.y, R, d.y)
    if not rows:
        d.text(MARGIN, d.y + 14, 'No stock moved in this period.', 10, color=MUTED)
    return d.render()


def stock_note(n, business):
    """One goods received note (GRN) or goods issue note (GIN): what, how many, from whom or to whom, and who signs."""
    grn = n['kind'] == 'RECEIPT'
    srn = n['kind'] == 'SUPPLIER_RETURN'
    title = 'GOODS RECEIVED NOTE' if grn else 'SUPPLIER RETURN NOTE' if srn else 'GOODS ISSUE NOTE'
    d = Doc(footer=(business.get('name') or 'Workshop') + ' | ' + n.get('doc_no', title))
    letterhead(d, business, title, [(n.get('doc_no', ''), True), ('Date: ' + n['date'], False)])
    facts = [('Note no.', n.get('doc_no', '-')), ('Date', n['date'])]
    if grn:
        facts += [('Supplier', n.get('supplier') or '-'), ('Supplier invoice / delivery no.', n.get('reference') or '-'), ('Received into stock by', n.get('actor', '-'))]
        if n.get('unit_cost') is not None:
            cost = Decimal(str(n['unit_cost']))
            facts += [('Cost price (per unit)', 'LKR ' + m(cost)), ('Cost of this delivery', 'LKR ' + m(cost * Decimal(str(n['quantity']))))]
    elif srn:
        facts += [('Returned to', n.get('supplier') or '-'), ('Reason', n.get('reason') or '-'), ('Supplier credit note no.', n.get('reference') or '-'), ('Sent back by', n.get('actor', '-'))]
    else:
        facts += [('Handed to', n.get('receiver_name') or '-'), ('For job / vehicle', n.get('job_registration') or '-'), ('Issued by', n.get('actor', '-'))]
    y = d.y + 4
    for label, value in facts:
        d.text(MARGIN, y + 10, label, 9, color=MUTED)
        d.text(260, y + 10, fit(value, 280, 10), 10, True)
        y += 17
    d.y = y + 12
    lines = n.get('lines') or [n]
    costed = (grn or srn) and any(l.get('unit_cost') is not None for l in lines)
    qx = R - 150 if costed else R - 120

    def head():
        d.rect(MARGIN, d.y, R - MARGIN, 18, GREY)
        d.text(MARGIN + 6, d.y + 12, 'ITEM', 8, True)
        if costed:
            d.text(R - 60, d.y + 12, 'COST (LKR)', 8, True, 'r')
        d.text(qx, d.y + 12, 'QUANTITY', 8, True, 'r')
        d.text(R - 6, d.y + 12, 'UNIT', 8, True, 'r')
        d.y += 18
    head()
    spent = Decimal('0')
    for l in lines:
        if d.room(38):
            head()
        d.text(MARGIN + 6, d.y + 14, fit(l['name'], 300, 10.5), 10.5, True)
        d.text(MARGIN + 6, d.y + 26, fit(' | '.join(x for x in (l.get('sku'), l.get('part_number') and 'Part no. ' + l['part_number'], l.get('location')) if x), 300, 8), 8, color=MUTED)
        if costed and l.get('unit_cost') is not None:
            d.text(R - 60, d.y + 17, m(Decimal(str(l['unit_cost']))), 10, False, 'r')
            spent += Decimal(str(l['unit_cost'])) * Decimal(str(l['quantity']))
        d.text(qx, d.y + 17, q(l['quantity']), 11, True, 'r')
        d.text(R - 6, d.y + 17, 'litres' if l.get('unit') == 'LITRE' else 'pcs', 9.5, align='r')
        d.y += 36
        if len(lines) > 1:
            d.line(MARGIN, d.y - 2, R, d.y - 2, 0.4)
    if len(lines) > 1:
        d.text(MARGIN + 6, d.y + 12, str(len(lines)) + ' items', 9, True)
        if costed and spent:
            d.text(R - 6, d.y + 12, 'Cost of this delivery: LKR ' + m(spent), 9.5, True, 'r')
        d.y += 18
    d.line(MARGIN, d.y, R, d.y)
    if n.get('note'):
        d.paragraph(MARGIN, 'Note: ' + n['note'], R - MARGIN, 9, bold=False)
    d.y += 70
    d.room(60)
    for x0, label in ((MARGIN, 'Issued by (signature)' if not grn else 'Received by (signature)'), (320, 'Received by (signature)' if not grn else 'Supplier / driver (signature)')):
        d.line(x0, d.y, x0 + 210, d.y)
        d.text(x0, d.y + 12, label, 8.5, color=MUTED)
    return d.render()


def return_note(n, business):
    """A customer return note: which parts of a bill came back, what they were worth, and how any money was given back.
    The customer keeps one copy and signs the shop's."""
    title = 'RETURN NOTE'
    d = Doc(footer=(business.get('name') or 'Workshop') + ' | ' + n['number'])
    letterhead(d, business, title, [(n['number'], True), ('Date: ' + n['date'], False)])
    facts = [('Return note no.', n['number']), ('Date', n['date']), ('Against invoice', n['invoice_number']), ('Customer', n.get('customer') or '-'),
             ('Vehicle', ' '.join(x for x in (n.get('registration'), n.get('vehicle')) if x) or '-'), ('Reason', n.get('reason') or '-'), ('Taken back by', n.get('by') or '-')]
    y = d.y + 4
    for label, value in facts:
        d.text(MARGIN, y + 10, label, 9, color=MUTED)
        d.text(200, y + 10, fit(value, 340, 10), 10, True)
        y += 17
    d.y = y + 12

    def head():
        d.rect(MARGIN, d.y, R - MARGIN, 18, GREY)
        d.text(MARGIN + 6, d.y + 12, 'PART RETURNED', 8, True)
        d.text(R - 110, d.y + 12, 'QUANTITY', 8, True, 'r')
        d.text(R - 6, d.y + 12, 'VALUE (LKR)', 8, True, 'r')
        d.y += 18
    head()
    for l in n['lines']:
        if d.room(24):
            head()
        d.text(MARGIN + 6, d.y + 15, fit(l['name'], 330, 10.5), 10.5, True)
        d.text(R - 110, d.y + 15, q(l['quantity']), 10.5, False, 'r')
        d.text(R - 6, d.y + 15, m(l['amount']), 10.5, False, 'r')
        d.y += 24
        d.line(MARGIN, d.y - 2, R, d.y - 2, 0.4)
    d.y += 6
    for label, value, bold in ((('Tax on the returned parts', m(n['tax']), False),) if n['tax'] else ()) + (('Taken off the bill', 'LKR ' + m(n['amount']), True),
                                                                                                           ('Bill total now', 'LKR ' + m(n['total_now']), False)):
        d.text(R - 150, d.y + 12, label, 9.5, bold, 'r')
        d.text(R - 6, d.y + 12, value, 10, bold, 'r')
        d.y += 16
    if n.get('refunded'):
        d.y += 4
        d.text(R - 6, d.y + 12, 'Money given back: LKR ' + m(n['refunded']) + (' (' + n['refund_method'] + ')' if n.get('refund_method') else ''), 10, True, 'r')
        d.y += 16
    d.y += 70
    d.room(60)
    for x0, label in ((MARGIN, 'For the workshop (signature)'), (320, 'Customer (signature)')):
        d.line(x0, d.y, x0 + 210, d.y)
        d.text(x0, d.y + 12, label, 8.5, color=MUTED)
    return d.render()

def statement(data, business):
    """A customer's statement: the bills still to be paid, the payments received on them, and what is owed in all."""
    c = data['customer']
    d = Doc(footer=(business.get('name') or 'Workshop') + ' | statement | ' + c['name'])
    letterhead(d, business, 'STATEMENT', [('Printed: ' + data['printed'], False)])
    left = block(d, MARGIN, 280, 'CUSTOMER', [(c['name'], 11, True), (c.get('phone'), 9.5, False), (c.get('address'), 9, False)])
    d.rect(330, d.y, R - 330, 46, WASH)
    d.text(342, d.y + 16, 'Total owed (' + data['currency'] + ')', 9, color=MUTED)
    d.text(R - 10, d.y + 38, m(data['balance']), 16, True, 'r')
    d.y = max(left, d.y + 46) + 14

    def table(title, heads, rows_, aligns, xs, widths):
        d.room(50)
        d.text(MARGIN, d.y + 8, title, 8, True, color=MUTED)
        d.y += 14
        d.rect(MARGIN, d.y, R - MARGIN, 17, GREY)
        for h, a, x in zip(heads, aligns, xs):
            d.text(x, d.y + 12, h, 8, True, a)
        d.y += 17
        for row in rows_:
            d.room(16)
            for cell, a, x, w in zip(row, aligns, xs, widths):
                d.text(x, d.y + 12, fit(cell, w, 9), 9, align=a)
            d.y += 16
            d.line(MARGIN, d.y, R, d.y)
        d.y += 14
    if data['owed']:
        table('BILLS TO BE PAID', ['DATE', 'BILL', 'VEHICLE', 'TOTAL', 'PAID', 'BALANCE'],
              [(r['date'], r['number'], r['registration'], m(r['total']), m(r['paid']), m(r['balance'])) for r in data['owed']],
              ['l', 'l', 'l', 'r', 'r', 'r'], [MARGIN + 6, MARGIN + 76, 300, 400, 470, R - 6], [66, 210, 90, 90, 90, 90])
    else:
        d.text(MARGIN, d.y + 12, 'Nothing is owed. Thank you.', 10, color=MUTED)
        d.y += 24
    if data['payments']:
        table('PAYMENTS RECEIVED ON THESE BILLS', ['DATE', 'BILL', 'METHOD', 'AMOUNT'], [(r['date'], r['number'], r['method'].title(), m(r['amount'])) for r in data['payments']],
              ['l', 'l', 'l', 'r'], [MARGIN + 6, MARGIN + 76, 300, R - 6], [66, 210, 90, 90])
    return d.render()

