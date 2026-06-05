import re
from pathlib import Path

root = Path(r'D:\DeepRead-v2\backend')
for f in root.rglob('*.py'):
    if '__pycache__' in str(f):
        continue
    try:
        content = f.read_text(encoding='utf-8')
        new = content.replace('parent.parent', 'parent.parent')
        if new != content:
            f.write_text(new, encoding='utf-8')
            print(f'FIXED: {f.name}')
    except Exception as e:
        print(f'SKIP: {f.name} ({e})')

print('Done.')
