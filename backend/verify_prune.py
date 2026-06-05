"""Quick verify: top-K graph pruning on 系统论 data."""
import json, os, sys
sys.path.insert(0, '/app')

from app.services.book_pipeline import _build_graph_json
from pathlib import Path

wiki = Path('/app/data/wiki/系统论')
g = _build_graph_json(wiki)
if g:
    nodes = len(g['nodes'])
    edges = len(g['edges'])
    comms = len(set(n['community_id'] for n in g['nodes']))
    print(f'Pruned graph: {nodes} nodes, {edges} edges, {comms} communities')
    # Show top nodes
    top = sorted(g['nodes'], key=lambda n: n['size'], reverse=True)[:8]
    for n in top:
        print(f'  size={n["size"]:.1f} [c{n["community_id"]}] {n["label"][:50]}')
    # Show edge weight distribution
    if edges:
        weights = [e['weight'] for e in g['edges']]
        print(f'\nEdge weights: min={min(weights):.1f} max={max(weights):.1f} avg={sum(weights)/len(weights):.1f}')
else:
    print('graph build returned None')
