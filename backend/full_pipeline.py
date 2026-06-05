"""Full pipeline run for 系统论 (122 chapters)."""
import asyncio, os, sys, shutil
sys.path.insert(0, '/app')

os.environ.setdefault('DEEPSEEK_API_KEY', 'sk-your-key-here')
os.environ.setdefault('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1')

from app.services.book_pipeline import run_book_pipeline

async def main():
    # Clean previous run state so we start fresh
    wiki_dir = '/app/data/wiki/系统论'
    todo = os.path.join(wiki_dir, '.todo.json')
    if os.path.exists(todo):
        os.remove(todo)
        print('Cleared previous .todo.json')
    else:
        print('Fresh run (no previous state)')

    result = await run_book_pipeline(
        '系统论',
        data_root='/app/data',
        run_analysis=True,
        run_generation=True,
        run_graph=True,
    )

    print('\n========== FULL PIPELINE RESULT ==========')
    for k, v in result.items():
        if k != 'errors':
            print(f'  {k}: {v}')
    if result.get('errors'):
        print(f'  errors (first 5):')
        for e in result['errors'][:5]:
            print(f'    - {e}')

    # Show wiki output summary
    if os.path.exists(wiki_dir):
        files = sorted(os.listdir(wiki_dir))
        md_count = sum(1 for f in files if f.endswith('.md'))
        graph_exists = 'graph.json' in files
        print(f'\n  wiki dir: {md_count} .md nodes, graph.json={graph_exists}')

asyncio.run(main())
