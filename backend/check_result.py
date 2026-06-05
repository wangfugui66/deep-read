import json, os
wiki='/app/data/wiki/系统论'
gf=os.path.join(wiki,'graph.json')
g=json.load(open(gf))
print(f'graph: {len(g["nodes"])} nodes, {len(g["edges"])} edges')
comms=len(set(n['community_id'] for n in g['nodes']))
print(f'communities: {comms}')
for sub in ('entities','concepts'):
    d=os.path.join(wiki,sub)
    n = sum(1 for f in os.listdir(d) if f.endswith('.md'))
    print(f'{sub}/: {n} .md files')
ld=os.path.join(wiki,'chapters_linked')
if os.path.exists(ld):
    n = sum(1 for f in os.listdir(ld) if f.endswith('.md'))
    print(f'chapters_linked/: {n} .md files')
top=sorted(g['nodes'],key=lambda n:n['size'],reverse=True)[:10]
print('\ntop nodes:')
for n in top:
    print(f'  size={n["size"]:.1f} [c{n["community_id"]}] {n["label"]}')
