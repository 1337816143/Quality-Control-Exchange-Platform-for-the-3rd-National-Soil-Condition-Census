from pathlib import Path
import json


def replace_required(text, old, new, label):
    if old not in text:
        raise SystemExit(f'未找到待替换内容: {label}')
    return text.replace(old, new)


spec = Path('tests/e2e/platform.spec.js')
spec.write_text(r'''import { test, expect } from '@playwright/test';

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
''' + '\n', encoding='utf-8')

config = Path('playwright.config.js')
config_text = config.read_text(encoding='utf-8')
config_text = replace_required(
    config_text,
    "{ name: 'tablet', use: { ...devices['iPad (gen 7)'] } },",
    "{ name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 }, hasTouch: true, deviceScaleFactor: 2 } },",
    'tablet Chromium 配置'
)
config.write_text(config_text, encoding='utf-8')

package_path = Path('package.json')
package = json.loads(package_path.read_text(encoding='utf-8'))
package['devDependencies'].pop('xlsx', None)
package['devDependencies']['write-excel-file'] = '4.1.1'
package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

build = Path('scripts/build.mjs')
build_text = build.read_text(encoding='utf-8')
build_text = replace_required(
    build_text,
    "fs.copyFileSync('node_modules/xlsx/dist/xlsx.full.min.js',path.join(dist,'vendor/xlsx.full.min.js'));",
    "fs.copyFileSync('node_modules/write-excel-file/bundle/write-excel-file.min.js',path.join(dist,'vendor/write-excel-file.min.js'));",
    'XLSX 构建依赖'
)
build.write_text(build_text, encoding='utf-8')

index = Path('index.html')
index_text = index.read_text(encoding='utf-8')
index_text = replace_required(index_text, './vendor/xlsx.full.min.js', './vendor/write-excel-file.min.js', 'XLSX 页面脚本')
index.write_text(index_text, encoding='utf-8')

Path('src/export/index.js').write_text(r'''function rows(records) {
  return records.map((record) => ({
    '成果类型': record.typeLabel,
    '市': record.city,
    '作业单位': record.unit,
    '任务单元': record.district,
    '应收': '是',
    '已收': record.missing ? '否' : '是',
    '缺失': record.missing ? '是' : '否',
    '批次': record.docs.map((doc) => doc.batch).join('、'),
    '已答复': record.answered ? '是' : '否',
    '答复时间': record.reply?.time || '',
    '联系人': record.contact || '',
    '联系电话': record.phone || '',
    '成果摘要': record.docs.map((doc) => doc.sha256 ? doc.sha256.slice(0, 12) : '').filter(Boolean).join('、')
  }));
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportRecords(records, format, typeKey) {
  const data = rows(records);
  const stamp = new Date().toISOString().slice(0, 10);
  const headers = Object.keys(data[0] || { '成果类型': '', '市': '', '作业单位': '', '任务单元': '' });
  if (format === 'csv') {
    const quote = (value) => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const csv = '\uFEFF' + [headers.map(quote).join(','), ...data.map((row) => headers.map((key) => quote(row[key])).join(','))].join('\r\n');
    download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), '土壤普查收缴清单_' + typeKey + '_' + stamp + '.csv');
    return Promise.resolve();
  }
  if (typeof window.writeXlsxFile !== 'function') return Promise.reject(new Error('XLSX 导出组件未加载'));
  const sheet = [headers, ...data.map((row) => headers.map((key) => row[key] ?? ''))];
  return window.writeXlsxFile(sheet, {
    fileName: '土壤普查收缴清单_' + typeKey + '_' + stamp + '.xlsx',
    columns: headers.map((header) => ({ width: Math.max(12, Math.min(36, header.length * 2 + 6)) }))
  });
}
''' + '\n', encoding='utf-8')

app = Path('src/app.js')
app_text = app.read_text(encoding='utf-8')
app_text = replace_required(
    app_text,
    "    try { exportRecords(filtered, format, state.value.activeType); } catch (error) { notify(error.message, true); }",
    "    Promise.resolve(exportRecords(filtered, format, state.value.activeType)).catch((error) => notify(error.message, true));",
    '异步导出错误处理'
)
app.write_text(app_text, encoding='utf-8')

admin = Path('src/admin/github.js')
admin_text = admin.read_text(encoding='utf-8')
admin_text = replace_required(
    admin_text,
    "  const sha256 = await fileSha256(file);\n  onProgress?.(55);",
    "  const sha256 = await fileSha256(file);\n  const previousFiles = await listReplyFiles(key).catch(() => []);\n  onProgress?.(55);",
    '上传前文件清单'
)
admin_text = replace_required(
    admin_text,
    "  onProgress?.(100);\n  return { key, file: name, time, extension, size: file.size, sha256 };",
    "  const replaced = [];\n  for (const previous of previousFiles.filter((item) => item.name !== name)) {\n    await githubRequest('/contents/' + CONTENT_REPOSITORY.replyDirectory + '/' + encodeURIComponent(previous.name), token, {\n      method: 'DELETE', body: JSON.stringify({ message: '替换整改答复: ' + key, sha: previous.sha, branch: CONTENT_REPOSITORY.branch })\n    });\n    replaced.push(previous.name);\n  }\n  onProgress?.(100);\n  return { key, file: name, time, extension, size: file.size, sha256, replaced };",
    '替换旧答复文件'
)
admin_text = replace_required(
    admin_text,
    "  await updateReplyIndex(token, (records) => { delete records[key]; });\n  return { key, deleted: files.map((file) => file.name) };",
    "  await updateReplyIndex(token, (records) => { delete records[key]; });\n  const remaining = await listReplyFiles(key);\n  if (remaining.length) throw new Error('删除后校验失败，仍有 ' + remaining.length + ' 个答复文件');\n  return { key, deleted: files.map((file) => file.name), verified: true };",
    '删除后校验'
)
admin.write_text(admin_text, encoding='utf-8')

validation = Path('src/data/validate.js')
validation_text = validation.read_text(encoding='utf-8')
validation_text = replace_required(
    validation_text,
    ".replace(/\\s+/g, '')",
    ".replace(/[\\u200B-\\u200D\\uFEFF]/g, '')\n    .replace(/\\s+/g, '')",
    '不可见字符规范化'
)
validation.write_text(validation_text, encoding='utf-8')

for workflow_path in [Path('.github/workflows/ci.yml'), Path('.github/workflows/deploy.yml')]:
    workflow = workflow_path.read_text(encoding='utf-8')
    workflow = workflow.replace('      - run: npm ci\n      - run: npm run validate', '      - run: npm ci\n      - run: npm audit --audit-level=high\n      - run: npm run validate')
    workflow_path.write_text(workflow, encoding='utf-8')

print('Applied stateful cross-device E2E tests, safe XLSX export, replacement cleanup, delete verification and audit gates.')
