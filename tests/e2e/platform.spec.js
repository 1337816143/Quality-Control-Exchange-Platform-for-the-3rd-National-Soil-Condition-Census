import { test, expect } from '@playwright/test';

const EXISTING_KEY = '沧州市_易景科技（天津）股份有限公司_孟村回族自治县';
const EXISTING_FILE = EXISTING_KEY + '_整改答复_20260728090000.pdf';
const initialRecord = {
  key: EXISTING_KEY,
  file: EXISTING_FILE,
  time: '20260728090000',
  extension: 'pdf',
  size: 128,
  sha256: 'a'.repeat(64),
  updatedAt: '2026-07-28T01:00:00.000Z'
};

function decodeIndexContent(content) {
  return JSON.parse(Buffer.from(String(content || ''), 'base64').toString('utf8'));
}

async function mockGithub(page) {
  const state = {
    records: { [EXISTING_KEY]: { ...initialRecord } },
    files: [{ type: 'file', name: EXISTING_FILE, sha: 'reply-sha', size: 128 }]
  };

  await page.route('**/api.github.com/repos/1337816143/soil-type-mapping-inventory/**', (route) =>
    route.fulfill({ status: 200, json: {} })
  );

  await page.route('**/raw.githubusercontent.com/1337816143/soil-type-mapping-inventory/main/replies/index.json**', (route) =>
    route.fulfill({ json: { version: 1, records: state.records } })
  );

  await page.route('**/api.github.com/repos/1337816143/soil-type-mapping-inventory/contents/replies**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const encodedName = url.pathname.split('/').pop() || '';
    const name = decodeURIComponent(encodedName);
    const isIndex = url.pathname.endsWith('/replies/index.json');

    if (method === 'GET' && isIndex) {
      const data = { version: 1, records: state.records };
      return route.fulfill({ json: { sha: 'index-sha', content: Buffer.from(JSON.stringify(data), 'utf8').toString('base64') } });
    }
    if (method === 'GET') return route.fulfill({ json: state.files });

    const body = request.postDataJSON() || {};
    if (method === 'PUT' && isIndex) {
      state.records = { ...(decodeIndexContent(body.content).records || {}) };
      return route.fulfill({ status: 200, json: { content: { sha: 'index-next' }, commit: { sha: 'commit-index' } } });
    }
    if (method === 'PUT') {
      state.files = state.files.filter((file) => file.name !== name);
      state.files.push({ type: 'file', name, sha: 'file-' + state.files.length, size: 256 });
      return route.fulfill({ status: 201, json: { content: { sha: 'file-next' }, commit: { sha: 'commit-file' } } });
    }
    if (method === 'DELETE') {
      state.files = state.files.filter((file) => file.name !== name);
      return route.fulfill({ status: 200, json: { commit: { sha: 'commit-delete' } } });
    }
    return route.fulfill({ status: 405, json: { message: 'unexpected mock request' } });
  });

  return state;
}

async function visibleSurface(page, isMobile) {
  const surface = isMobile
    ? page.locator('#resultsRoot .mobile-cards').first()
    : page.locator('#resultsRoot .desktop-table').first();
  await expect(surface).toBeVisible();
  return surface;
}

async function saveCredential(page) {
  await page.getByRole('button', { name: '管理员凭证' }).click();
  await page.locator('#adminToken').fill('test-token');
  await page.locator('#saveCredential').click();
  await expect(page.locator('#credentialModal')).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  await mockGithub(page);
  await page.goto('/');
  await expect(page.locator('#resultsRoot .city-section').first()).toBeVisible();
});

test('三个成果页签与参考资料页可切换', async ({ page }) => {
  for (const label of ['土壤类型图', '土壤属性图', '耕地质量评价']) {
    await page.getByRole('tab', { name: label }).click();
    await expect(page.locator('#resultsPanel')).toBeVisible();
  }
  await page.getByRole('tab', { name: '参考文件' }).click();
  await expect(page.locator('#referencePanel')).toBeVisible();
});

test('页签支持键盘导航', async ({ page }) => {
  const tabs = page.locator('#resultTabs [role="tab"]');
  await tabs.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(1)).toBeFocused();
});

test('全省、南北片区统计可以切换', async ({ page }) => {
  const initial = await page.locator('#summaryCards').innerText();
  await page.getByRole('button', { name: '北片区' }).click();
  const north = await page.locator('#summaryCards').innerText();
  await page.getByRole('button', { name: '南片区' }).click();
  const south = await page.locator('#summaryCards').innerText();
  expect(north).not.toBe(initial);
  expect(south).not.toBe(north);
});

test('缺失筛选和空结果状态', async ({ page, isMobile }) => {
  await page.selectOption('select[name="missing"]', 'missing');
  const surface = await visibleSurface(page, isMobile);
  await expect(surface.locator('.status-chip.missing').first()).toBeVisible();
  await page.fill('input[name="query"]', '__不存在的任务单元__');
  await expect(page.locator('#resultsRoot .empty-state')).toContainText('没有符合');
});

test('单文件和多批次成果可打开', async ({ page, isMobile }) => {
  const surface = await visibleSurface(page, isMobile);
  await expect(surface.locator('a.document-link:visible').first()).toHaveAttribute('target', '_blank');
  const menu = surface.locator('details.document-menu:visible').first();
  if (await menu.count()) {
    await menu.locator('summary').click();
    await expect(menu.locator('a').first()).toBeVisible();
  }
});

test('管理员凭证、上传弹窗与键盘关闭', async ({ page }) => {
  await page.getByRole('button', { name: '管理员凭证' }).click();
  await expect(page.locator('#credentialModal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#credentialModal')).toBeHidden();
  await page.locator('.upload-reply:visible').first().click();
  await expect(page.locator('#uploadModal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#uploadModal')).toBeHidden();
});

test('上传、替换和删除模拟流程', async ({ page }) => {
  await saveCredential(page);

  await page.locator('.upload-reply:visible').first().click();
  await page.locator('#replyFile').setInputFiles({ name: 'reply.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 upload') });
  await page.locator('#confirmUpload').click();
  await expect(page.locator('#toast')).toContainText('上传成功');

  await page.locator('.replace-reply:visible').first().click();
  await page.locator('#replyFile').setInputFiles({ name: 'replacement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 replace') });
  await page.locator('#confirmUpload').click();
  await expect(page.locator('#toast')).toContainText('上传成功');

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('.delete-reply:visible').first().click();
  await expect(page.locator('#deletePreview')).toContainText('整改答复');
  await page.locator('#confirmDelete').click();
  await expect(page.locator('#toast')).toContainText('已删除');
});

test('CSV 与 XLSX 可导出', async ({ page }) => {
  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出 CSV' }).click()
  ]);
  expect(csv.suggestedFilename()).toMatch(/\.csv$/);

  const [xlsx] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出 XLSX' }).click()
  ]);
  expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
});

test('移动端转换为卡片视图', async ({ page, isMobile }) => {
  if (!isMobile) test.skip();
  await expect(page.locator('.mobile-cards').first()).toBeVisible();
  await expect(page.locator('.desktop-table').first()).toBeHidden();
});

test('Logo 使用透明 PNG 且透明角像素正常', async ({ page }) => {
  const logo = page.locator('.header-logo');
  await expect(logo).toHaveAttribute('src', /soil-survey-logo\.png/);
  const dimensions = await logo.evaluate((image) => ({ width: image.naturalWidth, height: image.naturalHeight }));
  expect(dimensions).toEqual({ width: 549, height: 549 });
  const cornerAlpha = await logo.evaluate((image) => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return [[0, 0], [548, 0], [0, 548], [548, 548]].map(([x, y]) => context.getImageData(x, y, 1, 1).data[3]);
  });
  expect(cornerAlpha).toEqual([0, 0, 0, 0]);
});
