"""Parse PDF via pymupdf TOC → write chapter .md files."""
import os, sys
sys.path.insert(0, '/app')

from app.services.document_processor import _parse_pdf

SRC = '/app/data/raw/sources/系统论/系统论_系统科学哲学.pdf'
DST = '/app/data/raw/sources/系统论/chapters'

result = _parse_pdf(SRC)
chapters = result.get('chapters', [])
print(f'TOC chapters: {len(chapters)}, total pages: {result.get("total_pages", "?")}')

if chapters:
    os.makedirs(DST, exist_ok=True)
    for old in os.listdir(DST):
        os.remove(os.path.join(DST, old))

    for i, ch in enumerate(chapters):
        safe = ch['title'][:40].replace('/', '-').replace(' ', '_').replace('\n','').replace('\r','')
        fname = f'{i+1:02d}_{safe}.md'
        fpath = os.path.join(DST, fname)
        with open(fpath, 'w', encoding='utf-8') as f:
            f.write(f'# {ch["title"]}\n\n{ch["content"]}')
        pg = f'  p{ch.get("page_start","?")}-{ch.get("page_end","?")}' if ch.get("page_start") else ''
        print(f'  [{i+1}] {fname}  ({len(ch["content"])} chars{pg})')
    print(f'\nOK: {len(chapters)} chapters → {DST}/')
else:
    print('no chapters — writes fallback')
    os.makedirs(DST, exist_ok=True)
    for old in os.listdir(DST):
        os.remove(os.path.join(DST, old))
    import shutil
    shutil.copy(SRC.replace('.pdf', '.md'), os.path.join(DST, '01_full.md'))
    print('fallback: 01_full.md')
