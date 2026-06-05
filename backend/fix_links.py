"""Re-run auto-link + graph with fixed boundary matching."""
import os, sys, json
sys.path.insert(0, '/app')

from app.services.book_pipeline import _auto_link_chapters, _build_graph_json, _collect_all_entity_names
from pathlib import Path

raw_dir = Path('/app/data/raw/sources/系统论')
wiki_dir = Path('/app/data/wiki/系统论')

# Re-collect entity names (now with stop-word filtering)
names = _collect_all_entity_names(wiki_dir)
print(f'Filtered entities: {len(names)} (was ~2243)')

# Re-run auto-linking
links = _auto_link_chapters(raw_dir, wiki_dir)
print(f'Auto-links inserted: {links}')

# Check a sample
linked_dir = wiki_dir / 'chapters_linked'
files = sorted(linked_dir.iterdir())
if files:
    sample = files[5]
    c = sample.read_text(encoding='utf-8')[:500]
    print(f'\n--- {sample.name} preview ---')
    print(c)

# Re-run graph
g = _build_graph_json(wiki_dir)
if g:
    print(f'\nGraph: {len(g["nodes"])} nodes, {len(g["edges"])} edges')
    comms = len(set(n['community_id'] for n in g['nodes']))
    print(f'Communities: {comms}')
