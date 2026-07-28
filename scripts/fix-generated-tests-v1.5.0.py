from pathlib import Path

spec = Path('tests/e2e/platform.spec.js')
text = spec.read_text(encoding='utf-8')
text = text.replace("page.locator('.empty-state')).toContainText('没有符合')", "page.locator('#resultsRoot .empty-state')).toContainText('没有符合')")
spec.write_text(text, encoding='utf-8')

config = Path('playwright.config.js')
text = config.read_text(encoding='utf-8')
text = text.replace(
    "{ name: 'tablet', use: { ...devices['iPad (gen 7)'] } },",
    "{ name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 }, hasTouch: true, deviceScaleFactor: 2 } },"
)
config.write_text(text, encoding='utf-8')

print('Scoped empty-state assertion and configured tablet-width Chromium emulation.')
