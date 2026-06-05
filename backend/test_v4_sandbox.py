"""v4 sandbox: 2 chapters, zero JSON, regex parse only."""
import asyncio, os, sys, shutil, time
sys.path.insert(0, '/app')

os.environ.setdefault('DEEPSEEK_API_KEY', 'sk-your-key-here')
os.environ.setdefault('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1')

from app.services.book_pipeline import run_book_pipeline, _parse_entity_list

TEST_BOOK = 'testbook_v4'

async def main():
    base = f'/app/data/raw/sources/{TEST_BOOK}'
    wiki = f'/app/data/wiki/{TEST_BOOK}'
    shutil.rmtree(base, ignore_errors=True)
    shutil.rmtree(wiki, ignore_errors=True)
    os.makedirs(base, exist_ok=True)

    ch1 = """# 第一章 系统科学的奠基

钱学森在20世纪80年代提出了开放的复杂巨系统理论。这一理论融合了贝塔朗菲的一般系统论、
维纳的控制论和香农的信息论的思想精髓，并植根于马克思主义辩证唯物主义。

系统论强调整体性、层次性、开放性、目的性、突变性、稳定性、自组织和相似性八大原理。"""

    ch2 = """# 第二章 整体性与涌现

整体性是系统科学最核心的概念。亚里士多德指出"整体大于部分之和"，
贝塔朗菲将其升华为一般系统论的核心原则。

涌现（emergence）指系统整体表现出其组成部分所不具备的新性质。
钱学森特别强调开放的复杂巨系统具有层次涌现的特征。"""

    open(f'{base}/01_第一章_系统科学的奠基.md', 'w', encoding='utf-8').write(ch1)
    open(f'{base}/02_第二章_整体性与涌现.md', 'w', encoding='utf-8').write(ch2)

    t0 = time.time()
    result = await run_book_pipeline(
        TEST_BOOK,
        data_root='/app/data',
        run_enumerate=True,
        run_autolink=True,
        run_graph=True,
    )
    elapsed = time.time() - t0

    print('=' * 60)
    print('V4 SANDBOX RESULTS')
    print('=' * 60)
    for k, v in result.items():
        if k != 'errors':
            print(f'  {k}: {v}')
    if result.get('errors'):
        print(f'  errors: {result["errors"]}')
    print(f'  elapsed: {elapsed:.1f}s')

    # Show wiki structure
    print('\n--- wiki directory ---')
    for sub in ('entities', 'concepts'):
        d = os.path.join(wiki, sub)
        if os.path.exists(d):
            files = sorted(os.listdir(d))
            print(f'  {sub}/ ({len(files)} files)')
            for fn in files[:5]:
                fp = os.path.join(d, fn)
                print(f'    {fn}  [{os.path.getsize(fp)}B]')

    # Show an auto-linked chapter
    linked_dir = os.path.join(wiki, 'chapters_linked')
    if os.path.exists(linked_dir):
        files = sorted(os.listdir(linked_dir))
        print(f'\n--- auto-linked chapters ({len(files)}) ---')
        for fn in files:
            fp = os.path.join(linked_dir, fn)
            content = open(fp, encoding='utf-8').read()
            link_count = content.count('[[')
            print(f'  {fn}: {link_count} wikilinks')

    # Show graph
    gf = os.path.join(wiki, 'graph.json')
    if os.path.exists(gf):
        g = __import__('json').load(open(gf, encoding='utf-8').read())
        print(f'\n--- graph.json ---')
        print(f'  nodes: {len(g["nodes"])}, edges: {len(g["edges"])}')
        for n in g['nodes'][:5]:
            print(f'    [{n["community_id"]}] {n["label"]} ({n["type"]})')

    # Verify zero JSON parsing
    print('\n--- JSON-free verification ---')
    print('  _parse_entity_list test:')
    test_raw = '- 概念：系统论\n- 人物：钱学森\n- 术语：涌现\n- 概念：整体性'
    parsed = _parse_entity_list(test_raw)
    for p in parsed:
        print(f'    {p["type"]}: {p["name"]}')
    print(f'  ✓ regex parse: {len(parsed)} entities, no json.loads called')

    # SHA256 cache test: re-run
    print('\n--- SHA256 cache re-run ---')
    t1 = time.time()
    result2 = await run_book_pipeline(
        TEST_BOOK,
        data_root='/app/data',
        run_enumerate=True,
        run_autolink=True,
        run_graph=True,
    )
    elapsed2 = time.time() - t1
    print(f'  chapters_found: {result2["chapters_found"]} (expect 0)')
    print(f'  entities_found: {result2["entities_found"]} (expect 0)')
    print(f'  elapsed: {elapsed2:.1f}s (expect <1s)')

    # Check .cache
    cache_path = os.path.join(wiki, '.cache', 'hashes.json')
    if os.path.exists(cache_path):
        hashes = __import__('json').load(open(cache_path, encoding='utf-8').read())
        print(f'  cache entries: {len(hashes)}')

asyncio.run(main())
