"""Split a book MD into chapters using LLM-based chapter detection."""
import os
import sys
sys.path.insert(0, '/app')

from app.services.document_processor import _llm_detect_chapters

BOOK_DIR = '/app/data/raw/sources/系统论'
SRC = os.path.join(BOOK_DIR, '系统论_系统科学哲学.md')
DST = os.path.join(BOOK_DIR, 'chapters')

text = open(SRC, 'r', encoding='utf-8').read()
print(f'Source: {len(text)} chars')

chapters = _llm_detect_chapters(text)
if chapters:
    os.makedirs(DST, exist_ok=True)
    # remove old files
    for old in os.listdir(DST):
        os.remove(os.path.join(DST, old))
    for i, ch in enumerate(chapters):
        safe_title = ch['title'][:40].replace('/', '-').replace(' ', '_').replace('\n', '').replace('\r', '')
        fname = f'{i+1:02d}_{safe_title}.md'
        fpath = os.path.join(DST, fname)
        with open(fpath, 'w', encoding='utf-8') as f:
            f.write(f'# {ch["title"]}\n\n{ch["content"]}')
        print(f'  [{i+1}] {fname}  ({len(ch["content"])} chars)')
    print(f'\nOK: {len(chapters)} chapters → {DST}/')
else:
    print('LLM detected nothing — falling back to single file')
    os.makedirs(DST, exist_ok=True)
    for old in os.listdir(DST):
        os.remove(os.path.join(DST, old))
    import shutil
    shutil.copy(SRC, os.path.join(DST, '01_full.md'))
    print('fallback: 01_full.md')
