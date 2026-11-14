"""A small PDF page writer: A4, Helvetica and Helvetica-Bold, text, rules and filled boxes. No third-party package.

Coordinates are in points from the TOP-LEFT of the page (y grows downwards), which is how a layout is read.
Only printable ASCII is drawn; anything else becomes '?' (names are validated to English letters upstream).
"""
W, H, MARGIN = 595, 842, 40

# Glyph widths per 1000 units for ASCII 32..126 (Helvetica, Helvetica-Bold).
REGULAR = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584]
BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584]

INK, MUTED, LINE, ACCENT, WASH = (0.1, 0.12, 0.11), (0.42, 0.45, 0.44), (0.82, 0.85, 0.83), (0.2, 0.41, 0.31), (0.94, 0.96, 0.94)


def clean(s):
    return ''.join(c if 32 <= ord(c) < 127 else '?' for c in str(s))


def width(s, size=10, bold=False):
    table = BOLD if bold else REGULAR
    return sum(table[ord(c) - 32] for c in clean(s)) * size / 1000.0


def fit(s, max_width, size=10, bold=False):
    """Cut a single line with '...' so it fits."""
    s = clean(s)
    if width(s, size, bold) <= max_width:
        return s
    while s and width(s + '...', size, bold) > max_width:
        s = s[:-1]
    return s + '...'


def wrap(s, max_width, size=10, bold=False):
    """Word-wrap; a line break in the text starts a new line."""
    out = []
    for paragraph in str(s).split('\n'):
        out += _wrap_line(paragraph, max_width, size, bold)
    return out or ['']


def _wrap_line(s, max_width, size, bold):
    lines, line = [], ''
    for word in clean(s).split():
        trial = (line + ' ' + word).strip()
        if width(trial, size, bold) <= max_width or not line:
            line = trial
        else:
            lines.append(line)
            line = word
        while width(line, size, bold) > max_width and len(line) > 1:  # one very long word
            cut = len(line) - 1
            while cut > 1 and width(line[:cut], size, bold) > max_width:
                cut -= 1
            lines.append(line[:cut])
            line = line[cut:]
    return lines + ([line] if line else []) or ['']


def _esc(s):
    return clean(s).replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')


def _rgb(c):
    return '%.3f %.3f %.3f' % c


class Doc:
    def __init__(self, footer=''):
        self.pages, self.footer = [[]], footer
        self.y = MARGIN

    @property
    def ops(self):
        return self.pages[-1]

    def new_page(self):
        self.pages.append([])
        self.y = MARGIN

    def room(self, needed):
        """Start a new page when `needed` points do not fit above the bottom margin."""
        if self.y + needed > H - MARGIN - 18:
            self.new_page()
            return True
        return False

    def text(self, x, y, s, size=10, bold=False, align='l', color=INK):
        s = clean(s)
        w = width(s, size, bold)
        x = x - w if align == 'r' else x - w / 2 if align == 'c' else x
        self.ops.append('BT /%s %.1f Tf %s rg %.1f %.1f Td (%s) Tj ET' % ('F2' if bold else 'F1', size, _rgb(color), x, H - y, _esc(s)))

    def line(self, x1, y1, x2, y2, w=0.6, color=LINE):
        self.ops.append('%s RG %.2f w %.1f %.1f m %.1f %.1f l S' % (_rgb(color), w, x1, H - y1, x2, H - y2))

    def rect(self, x, y, w, h, fill=WASH, stroke=None):
        if fill is not None:
            self.ops.append('%s rg %.1f %.1f %.1f %.1f re f' % (_rgb(fill), x, H - y - h, w, h))
        if stroke is not None:
            self.ops.append('%s RG 0.6 w %.1f %.1f %.1f %.1f re S' % (_rgb(stroke), x, H - y - h, w, h))

    def qr(self, x, y, size, packed):
        """A QR code as plain squares. `packed` is 'N:' plus N*N characters of 0/1 (made by the browser when settings are saved)."""
        n, bits = packed.split(':')
        n = int(n)
        cell = size / n
        self.rect(x - 4, y - 4, size + 8, size + 8, (1, 1, 1))
        for r in range(n):
            row, c = bits[r * n:(r + 1) * n], 0
            while c < n:
                if row[c] != '1':
                    c += 1
                    continue
                e = c
                while e < n and row[e] == '1':
                    e += 1
                self.rect(x + c * cell, y + r * cell, (e - c) * cell + 0.2, cell + 0.2, INK)
                c = e

    def stamp(self, label, x, y, color, size=56, angle=18, page=0):
        """A rotated outlined stamp (PAID, VOID) on the first page; y is measured from the top."""
        import math
        c, sn = math.cos(math.radians(angle)), math.sin(math.radians(angle))
        w = width(label, size, True)
        # text matrix rotates around (x, H - y); centre the word first
        tx = x - (w / 2) * c + (size * 0.35) * sn
        ty = (H - y) - (w / 2) * sn - (size * 0.35) * c
        ops = self.pages[page]
        ops.append('q %s RG %s rg 2 w 1 Tr BT /F2 %.1f Tf %.4f %.4f %.4f %.4f %.1f %.1f Tm (%s) Tj ET Q' % (_rgb(color), _rgb(color), size, c, sn, -sn, c, tx, ty, _esc(label)))

    def paragraph(self, x, s, max_width, size=10, bold=False, color=INK, lead=1.35):
        for part in wrap(s, max_width, size, bold):
            self.room(size * lead)
            self.text(x, self.y + size, part, size, bold, color=color)
            self.y += size * lead

    def render(self):
        count = len(self.pages)
        objects = [b'<< /Type /Catalog /Pages 2 0 R >>',
                   ('<< /Type /Pages /Kids [' + ' '.join(str(3 + i * 2) + ' 0 R' for i in range(count)) + '] /Count ' + str(count) + ' >>').encode()]
        regular, bold = 3 + count * 2, 4 + count * 2
        for number, ops in enumerate(self.pages):
            foot = ['BT /F1 8 Tf %s rg %.1f %.1f Td (%s) Tj ET' % (_rgb(MUTED), MARGIN, 24, _esc(self.footer)),
                    'BT /F1 8 Tf %s rg %.1f %.1f Td (Page %d of %d) Tj ET' % (_rgb(MUTED), W - MARGIN - width('Page %d of %d' % (number + 1, count), 8), 24, number + 1, count)]
            stream = '\n'.join(ops + foot).encode()
            objects.append(('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] /Resources << /Font << /F1 %d 0 R /F2 %d 0 R >> >> /Contents %d 0 R >>' % (W, H, regular, bold, 4 + number * 2)).encode())
            objects.append(b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream')
        objects.append(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
        objects.append(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
        out, offsets = bytearray(b'%PDF-1.4\n'), []
        for index, body in enumerate(objects, 1):
            offsets.append(len(out))
            out += str(index).encode() + b' 0 obj\n' + body + b'\nendobj\n'
        start = len(out)
        out += b'xref\n0 ' + str(len(objects) + 1).encode() + b'\n0000000000 65535 f \n'
        for offset in offsets:
            out += ('%010d 00000 n \n' % offset).encode()
        out += b'trailer\n<< /Size ' + str(len(objects) + 1).encode() + b' /Root 1 0 R >>\nstartxref\n' + str(start).encode() + b'\n%%EOF\n'
        return bytes(out)
