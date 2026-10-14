#!/usr/bin/env python3
"""Любой исходный документ (.docx, .doc, .odt, .rtf, .pdf) → текст с номерами абзацев и строк таблиц.

Использование:
  python3 tools/doc2text.py ПОП.docx [out.txt] [--grep "Тема 1\\."]

Вывод (в порядке документа):
  [p00012] текст абзаца
  [t003 r05] ячейка | ячейка | ячейка

Зачем: нейросеть читает исходник по этому файлу и ссылается на номера абзацев, а не пересказывает.
Тексты в JSON ПОП/ФГОС потом сверяются с исходником инструментом tools/verify_sources.py.
.doc/.odt/.rtf сначала конвертируются LibreOffice (soffice) во временный .docx; .pdf читается pdfplumber/pdftotext.
"""
import os
import re
import subprocess
import sys
import tempfile


def to_docx(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == '.docx':
        return path
    out = tempfile.mkdtemp(prefix='doc2text_')
    subprocess.run(['soffice', '--headless', '--convert-to', 'docx', '--outdir', out, path],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    res = os.path.join(out, os.path.splitext(os.path.basename(path))[0] + '.docx')
    if not os.path.exists(res):
        sys.exit(f'Не удалось конвертировать {path} (нужен LibreOffice: soffice)')
    return res


def cell_text(cell):
    return ' '.join(p.text.strip() for p in cell.paragraphs if p.text.strip())


def docx_lines(path):
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    doc = Document(path)
    lines, p_no, t_no = [], 0, 0
    for el in doc.element.body.iterchildren():
        tag = el.tag.split('}')[1]
        if tag == 'p':
            p_no += 1
            t = Paragraph(el, doc).text.strip()
            if t:
                lines.append(f'[p{p_no:05d}] {t}')
        elif tag == 'tbl':
            t_no += 1
            for r_no, row in enumerate(Table(el, doc).rows, 1):
                cells, prev = [], None
                for c in row.cells:  # объединённые ячейки python-docx повторяет — убираем подряд идущие дубли
                    x = cell_text(c)
                    if c._tc is prev:
                        continue
                    prev = c._tc
                    cells.append(x)
                if any(cells):
                    lines.append(f'[t{t_no:03d} r{r_no:02d}] ' + ' | '.join(cells))
    return lines


def pdf_lines(path):
    try:
        import pdfplumber
        lines, n = [], 0
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages:
                for t in (page.extract_text() or '').split('\n'):
                    if t.strip():
                        n += 1
                        lines.append(f'[p{n:05d}] {t.strip()}')
        return lines
    except ImportError:
        txt = subprocess.run(['pdftotext', '-layout', path, '-'], capture_output=True, text=True, check=True).stdout
        return [f'[p{i:05d}] {t.strip()}' for i, t in enumerate((x for x in txt.split('\n') if x.strip()), 1)]


def read_lines(path):
    if path.lower().endswith('.pdf'):
        return pdf_lines(path)
    if path.lower().endswith('.txt'):
        return open(path, encoding='utf-8').read().splitlines()
    return docx_lines(to_docx(path))


def main():
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    grep = None
    if '--grep' in a:
        i = a.index('--grep'); grep = re.compile(a[i + 1]); del a[i:i + 2]
    lines = read_lines(a[0])
    if grep:
        lines = [x for x in lines if grep.search(x)]
    text = '\n'.join(lines) + '\n'
    if len(a) > 1:
        open(a[1], 'w', encoding='utf-8').write(text)
        print(f'{a[1]}: строк {len(lines)}')
    else:
        sys.stdout.write(text)


if __name__ == '__main__':
    main()
