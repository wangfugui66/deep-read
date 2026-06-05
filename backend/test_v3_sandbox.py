"""2-chapter sandbox test for LLM Wiki v3 pipeline."""
import asyncio, os, sys, shutil
sys.path.insert(0, '/app')

os.environ.setdefault('DEEPSEEK_API_KEY', 'sk-your-key-here')
os.environ.setdefault('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1')

from app.services.book_pipeline import run_book_pipeline

TEST_BOOK = 'testbook_v3'

async def main():
    base = f'/app/data/raw/sources/{TEST_BOOK}'
    wiki = f'/app/data/wiki/{TEST_BOOK}'
    shutil.rmtree(base, ignore_errors=True)
    shutil.rmtree(wiki, ignore_errors=True)
    os.makedirs(base, exist_ok=True)

    # Write 2 test chapters
    ch1 = """# 第一章 系统科学的奠基

钱学森在20世纪80年代提出了开放的复杂巨系统理论。这一理论融合了贝塔朗菲的一般系统论、
维纳的控制论和香农的信息论的思想精髓，并植根于马克思主义辩证唯物主义。

系统论强调整体性：系统的整体功能大于各部分功能之和，即"整体涌现性"。层次性意味着
系统由不同层级的子系统构成，每个层级有着独特的规律。开放性是系统演化的基本条件——
系统与环境之间的物质、能量和信息交换推动系统的自组织演化。"""

    ch2 = """# 第二章 整体性与涌现

整体性是系统科学最核心的概念之一。亚里士多德早已指出"整体大于部分之和"，贝塔朗菲
将其升华为一般系统论的核心原则。

涌现（emergence）指系统整体表现出其组成部分所不具备的新性质。例如，水分子不具备
"湿"的性质，但大量水分子聚集后涌现出液体的流动性。钱学森特别强调，开放的复杂巨
系统具有层次涌现的特征——每个层次都有新的规律产生。"""

    open(f'{base}/01_第一章_系统科学的奠基.md', 'w', encoding='utf-8').write(ch1)
    open(f'{base}/02_第二章_整体性与涌现.md', 'w', encoding='utf-8').write(ch2)

    result = await run_book_pipeline(
        TEST_BOOK,
        data_root='/app/data',
        run_ingestion=True,
        run_graph=True,
    )

    print('\n========== SANDBOX RESULT ==========')
    for k, v in result.items():
        if k != 'errors':
            print(f'  {k}: {v}')
    if result.get('errors'):
        print(f'  errors: {result["errors"]}')

    # Show output
    for sub in ('entities', 'concepts'):
        d = os.path.join(wiki, sub)
        if os.path.exists(d):
            print(f'\n  --- {sub}/ ---')
            for f in sorted(os.listdir(d)):
                fp = os.path.join(d, f)
                print(f'    {f}  ({os.path.getsize(fp)}B)')
                content = open(fp, encoding='utf-8').read()
                print(f'    --- preview ---')
                print(content[:400])
                print()

    # Show graph
    gf = os.path.join(wiki, 'graph.json')
    if os.path.exists(gf):
        g = __import__('json').loads(open(gf, encoding='utf-8'))
        print(f'\n  graph.json: {len(g["nodes"])} nodes, {len(g["edges"])} edges')
        for n in g['nodes'][:3]:
            print(f'    node: {n["label"]} (community {n["community_id"]})')

    # SHA256 cache test: re-run should skip
    print('\n  --- Re-run (should skip all via SHA256 cache) ---')
    result2 = await run_book_pipeline(
        TEST_BOOK,
        data_root='/app/data',
        run_ingestion=True,
        run_graph=True,
    )
    print(f'  nodes_written: {result2["nodes_written"]} (expect 0 — all cached)')

asyncio.run(main())
