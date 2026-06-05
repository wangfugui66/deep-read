"""Full E2E: 系统论 (122 chapters), v4 pipeline."""
import asyncio, os, sys, time
sys.path.insert(0, '/app')

os.environ.setdefault('DEEPSEEK_API_KEY', 'sk-your-key-here')
os.environ.setdefault('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1')

from app.services.book_pipeline import run_book_pipeline

async def main():
    t0 = time.time()

    # Reset previous state so we start fresh
    import shutil
    cache = '/app/data/wiki/系统论/.cache'
    todo = '/app/data/wiki/系统论/.todo.json'
    for p in (cache, todo):
        try:
            if os.path.isdir(p):
                shutil.rmtree(p)
            elif os.path.isfile(p):
                os.remove(p)
        except:
            pass

    result = await run_book_pipeline(
        '系统论',
        data_root='/app/data',
        run_enumerate=True,
        run_autolink=True,
        run_graph=True,
    )

    elapsed = time.time() - t0

    print('=' * 60)
    print('FULL E2E: 系统论 (122 chapters)')
    print('=' * 60)
    for k, v in result.items():
        if k != 'errors':
            print(f'  {k}: {v}')
    if result.get('errors'):
        print(f'  errors (first 3):')
        for e in result['errors'][:3]:
            print(f'    - {e}')
    print(f'\n  elapsed: {elapsed:.0f}s ({elapsed/60:.1f}min)')

    # Show summary
    wiki = '/app/data/wiki/系统论'
    for sub in ('entities', 'concepts'):
        d = os.path.join(wiki, sub)
        if os.path.exists(d):
            n = len(os.listdir(d))
            print(f'  {sub}: {n} files')

    linked = os.path.join(wiki, 'chapters_linked')
    if os.path.exists(linked):
        print(f'  chapters_linked: {len(os.listdir(linked))} files')
        # Show one linked chapter
        files = sorted(os.listdir(linked))
        if files:
            sample = open(os.path.join(linked, files[10]), encoding='utf-8').read()
            links = sample.count('[[')
            print(f'    sample {files[10]}: {links} wikilinks, {len(sample)} chars')

    gf = os.path.join(wiki, 'graph.json')
    if os.path.exists(gf):
        import json
        g = json.loads(open(gf, encoding='utf-8').read())
        print(f'\n  graph.json: {len(g["nodes"])} nodes, {len(g["edges"])} edges')
        comms = set(n['community_id'] for n in g['nodes'])
        print(f'  communities: {len(comms)}')
        # Top nodes by size
        top = sorted(g['nodes'], key=lambda n: n['size'], reverse=True)[:5]
        for n in top:
            print(f'    size={n["size"]:.1f}  [{n["community_id"]}] {n["label"]}')

asyncio.run(main())
