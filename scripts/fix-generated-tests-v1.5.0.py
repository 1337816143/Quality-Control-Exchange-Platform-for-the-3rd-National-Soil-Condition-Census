from pathlib import Path

spec = Path('tests/e2e/platform.spec.js')
text = spec.read_text(encoding='utf-8')
text = text.replace(
    "test('缺失筛选和空结果状态', async ({ page }) => {\n  await page.selectOption('select[name=\"missing\"]','missing'); await expect(page.locator('[data-missing=\"true\"]').first()).toBeVisible();",
    "test('缺失筛选和空结果状态', async ({ page, isMobile }) => {\n  await page.selectOption('select[name=\"missing\"]','missing');\n  const missing = isMobile ? page.locator('.mobile-cards .status-chip.missing').first() : page.locator('.desktop-table tr[data-missing=\"true\"]').first();\n  await expect(missing).toBeVisible();"
)
text = text.replace(
    "test('单文件和多批次成果可打开', async ({ page }) => {\n  await expect(page.locator('a.document-link').first()).toHaveAttribute('target','_blank');\n  const menu = page.locator('details.document-menu').first();",
    "test('单文件和多批次成果可打开', async ({ page, isMobile }) => {\n  const surface = isMobile ? page.locator('.mobile-cards') : page.locator('.desktop-table');\n  await expect(surface.locator('a.document-link').first()).toHaveAttribute('target','_blank');\n  const menu = surface.locator('details.document-menu').first();"
)
text = text.replace("page.locator('.upload-reply').first()", "page.locator('.upload-reply:visible').first()")
text = text.replace("page.locator('.empty-state')).toContainText('没有符合')", "page.locator('#resultsRoot .empty-state')).toContainText('没有符合')")
spec.write_text(text, encoding='utf-8')

config = Path('playwright.config.js')
text = config.read_text(encoding='utf-8')
text = text.replace(
    "{ name: 'tablet', use: { ...devices['iPad (gen 7)'] } },",
    "{ name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 }, hasTouch: true, deviceScaleFactor: 2 } },"
)
config.write_text(text, encoding='utf-8')

print('Configured tablet Chromium emulation and device-aware visible selectors.')
