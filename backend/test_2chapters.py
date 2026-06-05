"""Quick 2-chapter pipeline test to verify JSON fix."""
import asyncio, os, sys, shutil
sys.path.insert(0, '/app')

os.environ.setdefault('DEEPSEEK_API_KEY', 'sk-your-key-here')
os.environ.setdefault('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1')

from app.services.book_pipeline import run_book_pipeline

async def main():
    # Isolate: only 2 chapters plus a tiny test directory
    base = '/app/data/raw/sources/testbook'
    os.makedirs(base, exist_ok=True)
    for f in os.listdir(base):
        os.remove(os.path.join(base, f))

    # Write 2 fake chapters
    open(f'{base}/01_第一章_引言.md', 'w', encoding='utf-8').write(
        '# 第一章 引言\n\n钱学森是中国系统科学的奠基人，他在20世纪80年代提出了开放的复杂巨系统理论。'
        '这一理论吸收了贝塔朗菲的一般系统论、维纳的控制论和香农的信息论的精髓，并结合了马克思主义辩证唯物主义的思想。'
        '钱学森认为，系统论是沟通自然科学与社会科学的桥梁。'
    )
    open(f'{base}/02_第二章_基本概念.md', 'w', encoding='utf-8').write(
        '# 第二章 基本概念\n\n系统的核心概念包括整体性、层次性、开放性和目的性。'
        '整体性是系统最本质的特征：系统的整体功能大于各部分功能之和。'
        '层次性指系统由不同层级的子系统构成，每个层级有其独特规律。'
        '开放性强调系统与环境之间的物质、能量和信息交换是系统演化的基本条件。'
    )

    result = await run_book_pipeline(
        'testbook',
        data_root='/app/data',
        run_analysis=True,
        run_generation=True,
        run_graph=True,
    )

    print('\n=== 2-CHANNEL VERIFICATION ===')
    print(f'  status: {result["status"]}')
    print(f'  chapters_found: {result["chapters_found"]}')
    print(f'  entities_found: {result["entities_found"]}')
    print(f'  nodes_generated: {result["nodes_generated"]}')
    print(f'  graph_built: {result["graph_built"]}')
    if result.get('graph_nodes'):
        print(f'  graph_nodes: {result["graph_nodes"]}')
        print(f'  graph_edges: {result["graph_edges"]}')
    if result.get('errors'):
        print(f'  errors: {result["errors"]}')

    # Show generated wiki files
    wiki = '/app/data/wiki/testbook'
    if os.path.exists(wiki):
        files = sorted(os.listdir(wiki))
        print(f'\n  wiki files ({len(files)}):')
        for f in files:
            path = os.path.join(wiki, f)
            size = os.path.getsize(path)
            print(f'    {f}  ({size}B)')
        # Show first node content
        for f in files:
            if f.endswith('.md'):
                path = os.path.join(wiki, f)
                content = open(path, encoding='utf-8').read()[:300]
                print(f'\n  --- {f} preview ---')
                print(content)
                break

    # Cleanup
    shutil.rmtree(base, ignore_errors=True)
    shutil.rmtree(wiki, ignore_errors=True)

asyncio.run(main())
