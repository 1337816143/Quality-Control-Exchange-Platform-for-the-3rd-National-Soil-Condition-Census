from pathlib import Path

path = Path('tests/e2e/platform.spec.js')
text = path.read_text(encoding='utf-8')
text = text.replace("page.locator('.empty-state')).toContainText('没有符合')", "page.locator('#resultsRoot .empty-state')).toContainText('没有符合')")
path.write_text(text, encoding='utf-8')
print('Scoped empty-state assertion to the result panel.')
