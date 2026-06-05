"""Run the full knowledge pipeline for 系统论."""
import asyncio, os, sys
sys.path.insert(0, '/app')

os.environ.setdefault('DEEPSEEK_API_KEY', 'sk-your-key-here')

from app.services.book_pipeline import run_book_pipeline

async def main():
    result = await run_book_pipeline(
        '系统论',
        data_root='/app/data',
        run_analysis=True,
        run_generation=True,
        run_graph=True,
    )
    print('\n=== PIPELINE RESULT ===')
    for k, v in result.items():
        if k != 'errors':
            print(f'  {k}: {v}')
    if result.get('errors'):
        print(f'  errors (first 5):')
        for e in result['errors'][:5]:
            print(f'    - {e}')

asyncio.run(main())
