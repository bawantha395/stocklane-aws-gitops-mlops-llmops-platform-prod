"""A tiny PDF writer (Courier so columns line up, A4, plain text). No third-party package.
A line that starts with '#' is printed in bold."""
import textwrap

WIDTH, PER_PAGE = 84, 50


def _escape(line):
    clean = ''.join(c if 32 <= ord(c) < 127 else '?' for c in line)
    return clean.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')


def _wrap(lines):
    out = []
    for line in lines:
        bold = line.startswith('#')
        text = line[1:] if bold else line
        for part in (textwrap.wrap(text, WIDTH, subsequent_indent='  ', drop_whitespace=False) or ['']):
            out.append(('#' if bold else '') + part)
    return out


def document(title, lines):
    lines = _wrap(lines)
    pages = [lines[i:i + PER_PAGE] for i in range(0, len(lines), PER_PAGE)] or [[]]
    count = len(pages)
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>',
               ('<< /Type /Pages /Kids [' + ' '.join(str(3 + i * 2) + ' 0 R' for i in range(count)) + '] /Count ' + str(count) + ' >>').encode()]
    regular, bold = 3 + count * 2, 4 + count * 2
    for number, page in enumerate(pages):
        content = ['BT /F2 15 Tf 45 805 Td (' + _escape(title) + ') Tj ET']
        y = 778
        for line in page:
            font, text = ('F2', line[1:]) if line.startswith('#') else ('F1', line)
            content.append('BT /' + font + ' 10 Tf 45 ' + str(y) + ' Td (' + _escape(text) + ') Tj ET')
            y -= 14
        content.append('BT /F1 8 Tf 45 28 Td (Page ' + str(number + 1) + ' of ' + str(count) + ') Tj ET')
        stream = '\n'.join(content).encode()
        objects.append(('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ' + str(regular) + ' 0 R /F2 ' + str(bold) + ' 0 R >> >> /Contents ' + str(4 + number * 2) + ' 0 R >>').encode())
        objects.append(b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream')
    objects.append(b'<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>')
    objects.append(b'<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>')
    out = bytearray(b'%PDF-1.4\n')
    offsets = []
    for index, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += str(index).encode() + b' 0 obj\n' + body + b'\nendobj\n'
    start = len(out)
    out += b'xref\n0 ' + str(len(objects) + 1).encode() + b'\n0000000000 65535 f \n'
    for offset in offsets:
        out += ('%010d 00000 n \n' % offset).encode()
    out += b'trailer\n<< /Size ' + str(len(objects) + 1).encode() + b' /Root 1 0 R >>\nstartxref\n' + str(start).encode() + b'\n%%EOF\n'
    return bytes(out)
