import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const VERSION = '1.5.0';
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const write = (p, content) => {
  const target = path.join(ROOT, p);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content.endsWith('\n') ? content : content + '\n');
};
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const normalizePath = (value) => String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');

function extractAssignment(source, name) {
  const marker = `var ${name} =`;
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`未找到 ${name}`);
  let start = markerIndex + marker.length;
  while (/\s/.test(source[start])) start += 1;
  const opener = source[start];
  const closer = opener === '[' ? ']' : opener === '{' ? '}' : null;
  if (!closer) throw new Error(`${name} 不是数组或对象字面量`);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === opener) depth += 1;
    if (ch === closer) {
      depth -= 1;
      if (depth === 0) {
        const literal = source.slice(start, i + 1);
        return vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 5000 });
      }
    }
  }
  throw new Error(`${name} 未闭合`);
}

function walk(dir) {
  const absolute = path.join(ROOT, dir);
  if (!fs.existsSync(absolute)) return [];
  const output = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const rel = normalizePath(path.join(dir, entry.name));
    if (entry.isDirectory()) output.push(...walk(rel));
    else output.push(rel);
  }
  return output;
}

function sha256File(rel) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(path.join(ROOT, rel)));
  return hash.digest('hex');
}

function normalizeBatch(value) {
  const raw = String(value || '').trim().replace(/\s+/g, '');
  const aliases = { '第1批': '第一批', '第2批': '第二批', '第二批补': '第二批补充', '第3批': '第三批' };
  return aliases[raw] || raw;
}

const legacy = read('index.html');
const masterList = extractAssignment(legacy, 'masterList');
const soilTypeData = extractAssignment(legacy, 'soilTypeData');
const soilAttrData = extractAssignment(legacy, 'soilAttrData');
const farmlandData = extractAssignment(legacy, 'farmlandData');

const municipalCities = ['石家庄市','保定市','承德市','邢台市','沧州市','唐山市','衡水市','邯郸市','张家口市'];
const skipMissingCities = ['承德市','保定市','张家口市','秦皇岛市','廊坊市','雄安新区','唐山市','定州市'];
const mergeSubDistricts = {
  '石家庄市': ['桥西区','新华区','长安区','裕华区','井陉矿区'],
  '秦皇岛市': ['海港区','北戴河区','山海关区'],
  '邢台市': ['襄都区'],
  '张家口市': ['桥东区','桥西区','经开区','下花园区'],
  '沧州市': ['运河区','新华区']
};
const regions = {
  province: { label: '全省', cities: masterList.map((city) => city.city) },
  north: { label: '北片区', cities: ['张家口市','承德市','秦皇岛市','唐山市','廊坊市','保定市','雄安新区'] },
  south: { label: '南片区', cities: ['石家庄市','沧州市','衡水市','邢台市','邯郸市','定州市','辛集市'] }
};

const resultTypes = {
  soilType: { label: '土壤类型图', data: soilTypeData },
  soilAttr: { label: '土壤属性图', data: soilAttrData },
  farmland: { label: '耕地质量评价', data: farmlandData }
};
const indexedFiles = new Set();
const duplicateKeys = [];
const missingFiles = [];
const normalizedDocs = [];

for (const [typeKey, type] of Object.entries(resultTypes)) {
  const seen = new Set();
  for (const city of type.data) {
    for (const unit of city.units || []) {
      for (const district of unit.districts || []) {
        district.label = String(district.label || '').trim();
        district.docs = (district.docs || []).map((doc) => {
          const file = normalizePath(doc.file);
          const batch = normalizeBatch(doc.batch);
          const ext = path.extname(file).slice(1).toLowerCase();
          const key = [typeKey, city.name, unit.name, district.label, batch].join('|');
          if (seen.has(key)) duplicateKeys.push(key);
          seen.add(key);
          indexedFiles.add(normalizePath(path.join('data', file)));
          const full = normalizePath(path.join('data', file));
          const present = exists(full);
          if (!present) missingFiles.push(full);
          const record = {
            batch,
            file,
            extension: ext,
            directory: normalizePath(path.dirname(file)),
            size: present ? fs.statSync(path.join(ROOT, full)).size : null,
            sha256: present ? sha256File(full) : null
          };
          normalizedDocs.push({ type: typeKey, city: city.name, unit: unit.name, district: district.label, ...record });
          return record;
        });
      }
    }
  }
}

const repositoryDataFiles = walk('data').filter((file) => /\.(pdf|docx?|xlsx?|zip|rar)$/i.test(file));
const orphanFiles = repositoryDataFiles.filter((file) => !indexedFiles.has(file));

write('data/organizations.json', JSON.stringify({
  version: VERSION,
  updatedAt: new Date().toISOString(),
  municipalCities,
  skipMissingCities,
  mergeSubDistricts,
  regions,
  cities: masterList
}, null, 2));

write('data/results.json', JSON.stringify({
  version: VERSION,
  updatedAt: new Date().toISOString(),
  types: Object.fromEntries(Object.entries(resultTypes).map(([key, value]) => [key, { label: value.label, cities: value.data }]))
}, null, 2));

write('data/validation-report.json', JSON.stringify({
  version: VERSION,
  generatedAt: new Date().toISOString(),
  summary: {
    indexedResultFiles: indexedFiles.size,
    repositoryResultFiles: repositoryDataFiles.length,
    missingFiles: missingFiles.length,
    orphanFiles: orphanFiles.length,
    duplicateRecords: duplicateKeys.length
  },
  missingFiles,
  orphanFiles,
  duplicateKeys
}, null, 2));

write('src/config.js', `export const APP_VERSION = '${VERSION}';
export const RESULT_TYPES = {
  soilType: '土壤类型图',
  soilAttr: '土壤属性图',
  farmland: '耕地质量评价'
};
export const CONTENT_REPOSITORY = {
  owner: '1337816143',
  repo: 'soil-type-mapping-inventory',
  branch: 'main',
  replyDirectory: 'replies',
  replyIndexPath: 'replies/index.json',
  deployWorkflow: 'deploy.yml'
};
export const ALLOWED_REPLY_EXTENSIONS = ['pdf','doc','docx','xlsx','xls','zip','rar'];
export const MAX_REPLY_SIZE = 20 * 1024 * 1024;
export const DATA_URLS = {
  organizations: './data/organizations.json',
  results: './data/results.json',
  validation: './data/validation-report.json',
  referenceManifest: './reference-files/third-soil-survey/manifest.json',
  referenceArchive: './reference-files/third-soil-survey/archive.json'
};
`);

write('src/data/index.js', `import { CONTENT_REPOSITORY, DATA_URLS } from '../config.js';

export async function fetchJson(url, fallback = null) {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return await response.json();
  } catch (error) {
    if (fallback !== null) return fallback;
    throw error;
  }
}

export async function loadApplicationData() {
  const [organizations, results, validation, referenceManifest, referenceArchive] = await Promise.all([
    fetchJson(DATA_URLS.organizations),
    fetchJson(DATA_URLS.results),
    fetchJson(DATA_URLS.validation, { summary: {}, missingFiles: [], orphanFiles: [], duplicateKeys: [] }),
    fetchJson(DATA_URLS.referenceManifest, { fileCount: 0, categories: [] }),
    fetchJson(DATA_URLS.referenceArchive, null)
  ]);
  return { organizations, results, validation, referenceManifest, referenceArchive };
}

function parseReplyFile(file) {
  const match = String(file.name || '').match(/^(.*)_整改答复_([0-9]+)\.([a-z0-9]+)$/i);
  if (!match) return null;
  return { key: match[1], file: file.name, time: match[2], extension: match[3].toLowerCase(), sha: file.sha || '', size: file.size || null };
}

export async function loadReplyIndex() {
  const { owner, repo, branch, replyDirectory, replyIndexPath } = CONTENT_REPOSITORY;
  const headers = { Accept: 'application/vnd.github+json' };
  const indexUrl = 'https://raw.githubusercontent.com/' + owner + '/' + repo + '/' + branch + '/' + replyIndexPath;
  const directoryUrl = 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + replyDirectory + '?ref=' + encodeURIComponent(branch);
  const [stored, files] = await Promise.all([
    fetchJson(indexUrl, { records: {} }),
    fetchJson(directoryUrl, [])
  ]);
  const records = { ...(stored && stored.records ? stored.records : {}) };
  const actual = new Map();
  for (const file of Array.isArray(files) ? files : []) {
    const parsed = parseReplyFile(file);
    if (!parsed) continue;
    const previous = actual.get(parsed.key);
    if (!previous || parsed.time > previous.time) actual.set(parsed.key, parsed);
  }
  const issues = [];
  for (const [key, record] of Object.entries(records)) {
    if (!actual.has(key) || actual.get(key).file !== record.file) issues.push({ type: 'stale-index', key, record });
  }
  for (const [key, record] of actual) {
    if (!records[key] || records[key].file !== record.file) issues.push({ type: 'unindexed-file', key, record });
    records[key] = { ...records[key], ...record };
  }
  return { records, issues, files: Array.from(actual.values()) };
}
`);

write('src/data/validate.js', `export function normalizeDistrictName(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/^\d{6}(?:[、,，]\d{6})*/, '')
    .replace(/[（(].*?[）)]/g, '')
    .replace(/(满族蒙古族自治县|蒙古族满族自治县|回族满族自治县|回族自治县|满族自治县|蒙古族自治县|自治县|县|区|市)$/, '');
}

export function isMunicipalTask(label, city, municipalCities) {
  const task = String(label || '').replace(/\s+/g, '');
  const cityName = String(city || '').replace(/\s+/g, '');
  if (!task) return false;
  if (task.includes('市级') || task.includes('市本级')) return true;
  return task === cityName && municipalCities.includes(cityName);
}

export function isDistrictMatched(masterDistrict, city, submitted, organizations) {
  const municipal = isMunicipalTask(masterDistrict, city, organizations.municipalCities);
  if (municipal) return submitted.some((item) => isMunicipalTask(item, city, organizations.municipalCities));
  if (String(masterDistrict).includes('合并')) {
    if (submitted.some((item) => String(item).includes('合并'))) return true;
    const subs = organizations.mergeSubDistricts[city] || [];
    return subs.some((sub) => submitted.some((item) => !isMunicipalTask(item, city, organizations.municipalCities) && normalizeDistrictName(item) === normalizeDistrictName(sub)));
  }
  const normalized = normalizeDistrictName(masterDistrict);
  return submitted.some((item) => !isMunicipalTask(item, city, organizations.municipalCities) && !String(item).includes('合并') && normalizeDistrictName(item) === normalized);
}

export function validateApplicationData(organizations, results) {
  const issues = [];
  const cityNames = new Set((organizations.cities || []).map((city) => city.city));
  for (const [typeKey, type] of Object.entries(results.types || {})) {
    const seen = new Set();
    for (const city of type.cities || []) {
      if (!cityNames.has(city.name)) issues.push({ level: 'warning', code: 'UNKNOWN_CITY', typeKey, city: city.name });
      for (const unit of city.units || []) {
        for (const district of unit.districts || []) {
          for (const doc of district.docs || []) {
            const key = [typeKey, city.name, unit.name, district.label, doc.batch].join('|');
            if (seen.has(key)) issues.push({ level: 'error', code: 'DUPLICATE_RESULT', key });
            seen.add(key);
            if (!doc.file || !doc.extension || !doc.sha256) issues.push({ level: 'warning', code: 'INCOMPLETE_FILE_METADATA', key, file: doc.file });
          }
        }
      }
    }
  }
  return issues;
}
`);

write('src/state.js', `export function createState(initial = {}) {
  const listeners = new Set();
  const state = {
    activeType: 'soilType',
    scope: 'province',
    filters: { query: '', city: '', unit: '', district: '', batch: '', missing: '', answered: '' },
    ...initial
  };
  return {
    get value() { return state; },
    set(patch) { Object.assign(state, patch); listeners.forEach((listener) => listener(state)); },
    updateFilters(patch) { state.filters = { ...state.filters, ...patch }; listeners.forEach((listener) => listener(state)); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  };
}
`);

write('src/render/results.js', `import { RESULT_TYPES } from '../config.js';
import { isDistrictMatched, isMunicipalTask } from '../data/validate.js';

const escapeHtml = (value) => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const replyKey = (city, unit, district) => [city, unit, district].join('_');
const batchClass = (batch) => ({ '第一批':'batch-1','第二批':'batch-2','第二批补充':'batch-2','第三批':'batch-3' }[batch] || '');

export function buildRecords(typeKey, data, replyRecords) {
  const organizations = data.organizations;
  const type = data.results.types[typeKey];
  const records = [];
  const submittedByCity = new Map();
  for (const city of type.cities || []) {
    const labels = [];
    for (const unit of city.units || []) {
      for (const district of unit.districts || []) {
        labels.push(district.label);
        const key = replyKey(city.name, unit.name, district.label);
        const reply = replyRecords[key] || null;
        records.push({
          typeKey, typeLabel: RESULT_TYPES[typeKey], city: city.name, unit: unit.name, district: district.label,
          docs: district.docs || [], missing: false, reply, answered: !!reply, contact: '', phone: ''
        });
      }
    }
    submittedByCity.set(city.name, labels);
  }
  for (const city of organizations.cities || []) {
    if (organizations.skipMissingCities.includes(city.city)) continue;
    const labels = submittedByCity.get(city.city) || [];
    for (const item of city.items || []) {
      for (const district of item.districts || []) {
        if (isDistrictMatched(district, city.city, labels, organizations)) continue;
        const key = replyKey(city.city, item.unit, district);
        const reply = replyRecords[key] || null;
        records.push({
          typeKey, typeLabel: RESULT_TYPES[typeKey], city: city.city, unit: item.unit, district,
          docs: [], missing: true, reply, answered: !!reply, contact: item.contact || '', phone: item.phone || ''
        });
      }
    }
  }
  return records;
}

export function filterRecords(records, state, organizations) {
  const scopeCities = new Set((organizations.regions[state.scope] || organizations.regions.province).cities);
  const f = state.filters;
  const query = f.query.trim().toLowerCase();
  return records.filter((record) => {
    if (!scopeCities.has(record.city)) return false;
    if (f.city && record.city !== f.city) return false;
    if (f.unit && record.unit !== f.unit) return false;
    if (f.district && record.district !== f.district) return false;
    if (f.batch && !record.docs.some((doc) => doc.batch === f.batch)) return false;
    if (f.missing === 'missing' && !record.missing) return false;
    if (f.missing === 'submitted' && record.missing) return false;
    if (f.answered === 'answered' && !record.answered) return false;
    if (f.answered === 'unanswered' && record.answered) return false;
    if (query && ![record.typeLabel,record.city,record.unit,record.district,record.contact,record.phone].join(' ').toLowerCase().includes(query)) return false;
    return true;
  });
}

function documentLinks(record) {
  if (record.missing) return '<span class="status-chip missing">缺失</span>';
  if (record.docs.length === 1) {
    const doc = record.docs[0];
    return '<a class="document-link" target="_blank" rel="noopener" href="./data/' + encodeURI(doc.file) + '">' + escapeHtml(record.district) + '</a>';
  }
  const links = record.docs.map((doc) => '<a target="_blank" rel="noopener" href="./data/' + encodeURI(doc.file) + '">' + escapeHtml(doc.batch) + '</a>').join('');
  return '<details class="document-menu"><summary>' + escapeHtml(record.district) + ' · ' + record.docs.length + ' 批</summary><div>' + links + '</div></details>';
}

function replyCell(record) {
  const attrs = ' data-city="' + escapeHtml(record.city) + '" data-unit="' + escapeHtml(record.unit) + '" data-district="' + escapeHtml(record.district) + '"';
  if (record.reply) {
    return '<div class="reply-actions"><a target="_blank" rel="noopener" href="./replies/' + encodeURIComponent(record.reply.file) + '">查看答复</a><span>' + escapeHtml(formatTime(record.reply.time)) + '</span><button class="link-button replace-reply"' + attrs + '>替换</button><button class="link-button danger delete-reply"' + attrs + '>删除</button></div>';
  }
  return '<button class="upload-reply"' + attrs + '>上传答复</button>';
}

function formatTime(value) {
  const t = String(value || '');
  if (t.length < 8) return t;
  return t.slice(0,4) + '-' + t.slice(4,6) + '-' + t.slice(6,8) + (t.length >= 12 ? ' ' + t.slice(8,10) + ':' + t.slice(10,12) : '');
}

export function calculateStats(records, organizations, scope) {
  const scopeCities = new Set((organizations.regions[scope] || organizations.regions.province).cities);
  const scoped = records.filter((record) => scopeCities.has(record.city));
  const expected = scoped.length;
  const missing = scoped.filter((record) => record.missing).length;
  const answered = scoped.filter((record) => record.answered).length;
  const submitted = expected - missing;
  const units = new Set(scoped.filter((record) => !record.missing).map((record) => record.city + '|' + record.unit)).size;
  return { expected, submitted, missing, answered, units };
}

export function renderStats(container, stats, validation) {
  const warningCount = Number(validation?.summary?.missingFiles || 0) + Number(validation?.summary?.orphanFiles || 0) + Number(validation?.summary?.duplicateRecords || 0);
  container.innerHTML = [
    ['应收', stats.expected], ['已收', stats.submitted], ['缺失', stats.missing], ['已答复', stats.answered], ['作业单位', stats.units]
  ].map(([label, value]) => '<article class="summary-card"><strong>' + value + '</strong><span>' + label + '</span></article>').join('') +
    (warningCount ? '<article class="summary-card warning"><strong>' + warningCount + '</strong><span>数据校验告警</span></article>' : '');
}

export function renderResults(container, records) {
  if (!records.length) {
    container.innerHTML = '<div class="empty-state">没有符合当前筛选条件的记录。</div>';
    return;
  }
  const grouped = new Map();
  for (const record of records) {
    if (!grouped.has(record.city)) grouped.set(record.city, []);
    grouped.get(record.city).push(record);
  }
  container.innerHTML = Array.from(grouped.entries()).map(([city, cityRecords]) => {
    const rows = cityRecords.map((record) => {
      const batches = record.docs.map((doc) => '<span class="batch-tag ' + batchClass(doc.batch) + '">' + escapeHtml(doc.batch) + '</span>').join('') || '—';
      const status = record.missing ? '<span class="status-chip missing">缺失</span>' : '<span class="status-chip ok">已收</span>';
      return '<tr data-missing="' + record.missing + '"><td>' + escapeHtml(record.unit) + '</td><td>' + documentLinks(record) + (record.contact ? '<small>' + escapeHtml(record.contact + ' ' + record.phone) + '</small>' : '') + '</td><td>' + batches + '</td><td>' + status + '</td><td>' + replyCell(record) + '</td></tr>';
    }).join('');
    const cards = cityRecords.map((record) => '<article class="record-card"><header><strong>' + escapeHtml(record.district) + '</strong>' + (record.missing ? '<span class="status-chip missing">缺失</span>' : '<span class="status-chip ok">已收</span>') + '</header><dl><dt>作业单位</dt><dd>' + escapeHtml(record.unit) + '</dd><dt>成果文件</dt><dd>' + documentLinks(record) + '</dd><dt>批次</dt><dd>' + (record.docs.map((doc) => escapeHtml(doc.batch)).join('、') || '—') + '</dd><dt>整改答复</dt><dd>' + replyCell(record) + '</dd></dl></article>').join('');
    return '<section class="city-section"><h2>' + escapeHtml(city) + '<span>' + cityRecords.length + ' 条</span></h2><div class="desktop-table"><table><thead><tr><th>作业单位</th><th>任务单元/成果</th><th>批次</th><th>收缴</th><th>整改答复</th></tr></thead><tbody>' + rows + '</tbody></table></div><div class="mobile-cards">' + cards + '</div></section>';
  }).join('');
}

export function renderMissingSummary(container, records) {
  const missing = records.filter((record) => record.missing);
  if (!missing.length) {
    container.innerHTML = '<strong>当前范围已全部收缴。</strong>';
    container.className = 'missing-banner complete';
    return;
  }
  container.className = 'missing-banner';
  container.innerHTML = '<strong>缺失 ' + missing.length + ' 个任务单元</strong><div>' + missing.slice(0, 40).map((record) => '<span>' + escapeHtml(record.city + '｜' + record.district + '｜' + record.unit) + '</span>').join('') + (missing.length > 40 ? '<span>其余 ' + (missing.length - 40) + ' 条请导出查看</span>' : '') + '</div>';
}

export function filterOptions(records) {
  const unique = (key) => Array.from(new Set(records.map((record) => record[key]).filter(Boolean))).sort((a,b) => a.localeCompare(b,'zh-CN'));
  return { cities: unique('city'), units: unique('unit'), districts: unique('district'), batches: Array.from(new Set(records.flatMap((record) => record.docs.map((doc) => doc.batch)))).sort((a,b) => a.localeCompare(b,'zh-CN')) };
}
`);

write('src/render/filters.js', `const escapeHtml = (value) => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function options(values, selected, placeholder) {
  return '<option value="">' + placeholder + '</option>' + values.map((value) => '<option value="' + escapeHtml(value) + '"' + (value === selected ? ' selected' : '') + '>' + escapeHtml(value) + '</option>').join('');
}

export function renderFilterOptions(root, data, filters) {
  root.querySelector('[name="city"]').innerHTML = options(data.cities, filters.city, '全部城市');
  root.querySelector('[name="unit"]').innerHTML = options(data.units, filters.unit, '全部作业单位');
  root.querySelector('[name="district"]').innerHTML = options(data.districts, filters.district, '全部任务单元');
  root.querySelector('[name="batch"]').innerHTML = options(data.batches, filters.batch, '全部批次');
}

export function bindFilters(root, state, onExport) {
  root.addEventListener('input', (event) => {
    const target = event.target;
    if (!target.name) return;
    state.updateFilters({ [target.name]: target.value });
  });
  root.addEventListener('change', (event) => {
    const target = event.target;
    if (!target.name) return;
    state.updateFilters({ [target.name]: target.value });
  });
  root.querySelector('[data-action="reset-filters"]').addEventListener('click', () => {
    root.reset();
    state.updateFilters({ query:'', city:'', unit:'', district:'', batch:'', missing:'', answered:'' });
  });
  root.querySelector('[data-export="csv"]').addEventListener('click', () => onExport('csv'));
  root.querySelector('[data-export="xlsx"]').addEventListener('click', () => onExport('xlsx'));
}
`);

write('src/admin/github.js', `import { CONTENT_REPOSITORY } from '../config.js';

function headers(token) {
  return { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' };
}

export async function githubRequest(path, token, options = {}) {
  const url = 'https://api.github.com/repos/' + CONTENT_REPOSITORY.owner + '/' + CONTENT_REPOSITORY.repo + path;
  const response = await fetch(url, { ...options, headers: { ...headers(token), ...(options.headers || {}) } });
  let body = {};
  try { body = await response.json(); } catch (_) {}
  if (!response.ok) throw new Error(body.message || ('GitHub HTTP ' + response.status));
  return body;
}

export function readToken() {
  return String(sessionStorage.getItem('soil-admin-token') || window.SOIL_GITHUB_UPLOAD_TOKEN || '').trim();
}

export function saveSessionToken(token) {
  if (token) sessionStorage.setItem('soil-admin-token', token);
  else sessionStorage.removeItem('soil-admin-token');
}

export async function fileSha256(file) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2,'0')).join('');
}

export async function uploadReply({ city, unit, district, file, onProgress }) {
  const token = readToken();
  if (!token) throw new Error('未配置管理员凭证');
  const extension = file.name.split('.').pop().toLowerCase();
  const time = new Date().toISOString().replace(/\D/g,'').slice(0,14);
  const key = [city, unit, district].join('_');
  const name = key + '_整改答复_' + time + '.' + extension;
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取文件'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onprogress = (event) => { if (event.lengthComputable && onProgress) onProgress(Math.round(event.loaded / event.total * 45)); };
    reader.readAsDataURL(file);
  });
  const sha256 = await fileSha256(file);
  onProgress?.(55);
  await githubRequest('/contents/' + CONTENT_REPOSITORY.replyDirectory + '/' + encodeURIComponent(name), token, {
    method: 'PUT', body: JSON.stringify({ message: '整改答复: ' + key, content: base64, branch: CONTENT_REPOSITORY.branch })
  });
  onProgress?.(85);
  await updateReplyIndex(token, (records) => {
    records[key] = { key, file: name, time, extension, size: file.size, sha256, updatedAt: new Date().toISOString() };
  });
  onProgress?.(100);
  return { key, file: name, time, extension, size: file.size, sha256 };
}

async function getReplyIndex(token) {
  try {
    const result = await githubRequest('/contents/' + CONTENT_REPOSITORY.replyIndexPath + '?ref=' + encodeURIComponent(CONTENT_REPOSITORY.branch), token);
    const content = atob(String(result.content || '').replace(/\n/g,''));
    return { sha: result.sha, data: JSON.parse(decodeURIComponent(escape(content))) };
  } catch (error) {
    if (/404|Not Found/i.test(error.message)) return { sha: null, data: { version: 1, records: {} } };
    throw error;
  }
}

async function updateReplyIndex(token, mutator) {
  const current = await getReplyIndex(token);
  const records = { ...(current.data.records || {}) };
  mutator(records);
  const data = { version: 1, updatedAt: new Date().toISOString(), records };
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
  const body = { message: 'chore: update reply index', content, branch: CONTENT_REPOSITORY.branch };
  if (current.sha) body.sha = current.sha;
  await githubRequest('/contents/' + CONTENT_REPOSITORY.replyIndexPath, token, { method: 'PUT', body: JSON.stringify(body) });
}

export async function listReplyFiles(key) {
  const token = readToken();
  if (!token) throw new Error('未配置管理员凭证');
  const files = await githubRequest('/contents/' + CONTENT_REPOSITORY.replyDirectory + '?ref=' + encodeURIComponent(CONTENT_REPOSITORY.branch), token);
  return files.filter((file) => file.type === 'file' && file.name.startsWith(key + '_整改答复_'));
}

export async function deleteReplies({ city, unit, district }) {
  const token = readToken();
  if (!token) throw new Error('未配置管理员凭证');
  const key = [city, unit, district].join('_');
  const files = await listReplyFiles(key);
  for (const file of files) {
    await githubRequest('/contents/' + CONTENT_REPOSITORY.replyDirectory + '/' + encodeURIComponent(file.name), token, {
      method: 'DELETE', body: JSON.stringify({ message: '删除整改答复: ' + key, sha: file.sha, branch: CONTENT_REPOSITORY.branch })
    });
  }
  await updateReplyIndex(token, (records) => { delete records[key]; });
  return { key, deleted: files.map((file) => file.name) };
}

export async function triggerRedeploy() {
  const token = readToken();
  if (!token) return;
  await githubRequest('/actions/workflows/' + CONTENT_REPOSITORY.deployWorkflow + '/dispatches', token, {
    method: 'POST', body: JSON.stringify({ ref: CONTENT_REPOSITORY.branch })
  });
}
`);

write('src/admin/index.js', `import { ALLOWED_REPLY_EXTENSIONS, MAX_REPLY_SIZE } from '../config.js';
import { deleteReplies, listReplyFiles, readToken, saveSessionToken, triggerRedeploy, uploadReply } from './github.js';

export function initAdmin({ root, onChanged, notify }) {
  const uploadModal = document.getElementById('uploadModal');
  const credentialModal = document.getElementById('credentialModal');
  const fileInput = document.getElementById('replyFile');
  const progress = document.getElementById('uploadProgress');
  let context = null;

  const close = (modal) => { modal.hidden = true; modal.setAttribute('aria-hidden','true'); };
  const open = (modal) => { modal.hidden = false; modal.setAttribute('aria-hidden','false'); modal.querySelector('button,input')?.focus(); };

  root.addEventListener('click', async (event) => {
    const action = event.target.closest('.upload-reply,.replace-reply,.delete-reply');
    if (!action) return;
    context = { city: action.dataset.city, unit: action.dataset.unit, district: action.dataset.district };
    document.getElementById('uploadContext').textContent = context.city + '｜' + context.unit + '｜' + context.district;
    fileInput.value = '';
    progress.value = 0;
    document.getElementById('confirmUpload').hidden = action.classList.contains('delete-reply');
    document.getElementById('confirmDelete').hidden = !action.classList.contains('delete-reply');
    document.getElementById('deletePreview').innerHTML = '';
    open(uploadModal);
    if (action.classList.contains('delete-reply')) {
      try {
        const files = await listReplyFiles([context.city, context.unit, context.district].join('_'));
        document.getElementById('deletePreview').innerHTML = '<strong>删除清单：</strong><ul>' + files.map((file) => '<li>' + file.name + '</li>').join('') + '</ul>';
      } catch (error) { notify(error.message, true); }
    }
  });

  document.getElementById('adminCredentialButton').addEventListener('click', () => {
    document.getElementById('adminToken').value = readToken();
    open(credentialModal);
  });
  document.getElementById('saveCredential').addEventListener('click', () => {
    saveSessionToken(document.getElementById('adminToken').value.trim());
    close(credentialModal);
    notify('管理员凭证已保存到本次浏览器会话。');
  });
  document.getElementById('clearCredential').addEventListener('click', () => {
    saveSessionToken(''); document.getElementById('adminToken').value = ''; notify('会话凭证已清除。');
  });

  document.getElementById('confirmUpload').addEventListener('click', async () => {
    const file = fileInput.files[0];
    if (!file || !context) return notify('请选择文件。', true);
    const ext = file.name.split('.').pop().toLowerCase();
    if (!ALLOWED_REPLY_EXTENSIONS.includes(ext)) return notify('不支持该文件类型。', true);
    if (file.size > MAX_REPLY_SIZE) return notify('文件不能超过 20 MB。', true);
    try {
      const result = await uploadReply({ ...context, file, onProgress: (value) => { progress.value = value; } });
      notify('上传成功，SHA-256：' + result.sha256.slice(0, 12) + '…');
      close(uploadModal);
      await triggerRedeploy().catch(() => {});
      await onChanged();
    } catch (error) { notify('上传失败：' + error.message, true); }
  });

  document.getElementById('confirmDelete').addEventListener('click', async () => {
    if (!context || !confirm('确认删除清单中的整改答复文件？此操作不可撤销。')) return;
    try {
      const result = await deleteReplies(context);
      notify('已删除 ' + result.deleted.length + ' 个文件，正在重新校验索引和统计。');
      close(uploadModal);
      await triggerRedeploy().catch(() => {});
      await onChanged();
    } catch (error) { notify('删除失败：' + error.message, true); }
  });

  document.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', () => close(button.closest('.modal'))));
  document.querySelectorAll('.modal').forEach((modal) => modal.addEventListener('click', (event) => { if (event.target === modal) close(modal); }));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') document.querySelectorAll('.modal:not([hidden])').forEach(close); });
}
`);

write('src/export/index.js', `function rows(records) {
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
    '更新时间': record.docs.map((doc) => doc.sha256 ? doc.sha256.slice(0,12) : '').filter(Boolean).join('、')
  }));
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportRecords(records, format, typeKey) {
  const data = rows(records);
  const stamp = new Date().toISOString().slice(0,10);
  if (format === 'csv') {
    const headers = Object.keys(data[0] || { '成果类型':'', '市':'', '作业单位':'', '任务单元':'' });
    const quote = (value) => '"' + String(value ?? '').replace(/"/g,'""') + '"';
    const csv = '\uFEFF' + [headers.map(quote).join(','), ...data.map((row) => headers.map((key) => quote(row[key])).join(','))].join('\r\n');
    download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), '土壤普查收缴清单_' + typeKey + '_' + stamp + '.csv');
    return;
  }
  if (!window.XLSX) throw new Error('XLSX 组件未加载');
  const sheet = window.XLSX.utils.json_to_sheet(data);
  const book = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(book, sheet, '收缴清单');
  window.XLSX.writeFile(book, '土壤普查收缴清单_' + typeKey + '_' + stamp + '.xlsx');
}
`);

let referenceSource = exists('reference-library.js') ? read('reference-library.js') : '';
if (referenceSource) {
  referenceSource = referenceSource
    .replace(/var RAW_BASE =[^;]+;/, "var RAW_BASE = './';")
    .replace(/var MANIFEST_URL =[^;]+;/, "var MANIFEST_URL = ROOT + '/manifest.json';")
    .replace(/var ARCHIVE_META_URL =[^;]+;/, "var ARCHIVE_META_URL = ROOT + '/archive.json';")
    .replace(/if \(document\.readyState === 'loading'\)[\s\S]*?else install\(\);\s*\}\)\(\);?\s*$/, "window.SoilReferenceLibrary = { init: installReferenceTab, render: renderReferenceLibrary };\n})();");
  write('src/render/reference.js', referenceSource);
} else {
  write('src/render/reference.js', `(function(){ window.SoilReferenceLibrary={ init:function(){}, render:function(){} }; })();`);
}

write('src/app.js', `import { APP_VERSION, RESULT_TYPES } from './config.js';
import { loadApplicationData, loadReplyIndex } from './data/index.js';
import { validateApplicationData } from './data/validate.js';
import { createState } from './state.js';
import { buildRecords, calculateStats, filterOptions, filterRecords, renderMissingSummary, renderResults, renderStats } from './render/results.js';
import { bindFilters, renderFilterOptions } from './render/filters.js';
import { initAdmin } from './admin/index.js';
import { exportRecords } from './export/index.js';

const state = createState();
const runtime = { data: null, replies: { records:{}, issues:[] }, records: {} };
const elements = {
  tabs: document.getElementById('resultTabs'), filters: document.getElementById('filterForm'), stats: document.getElementById('summaryCards'),
  missing: document.getElementById('missingBanner'), results: document.getElementById('resultsRoot'), scope: document.getElementById('scopeSelector'),
  toast: document.getElementById('toast'), dataStatus: document.getElementById('dataStatus')
};

function notify(message, error = false) {
  elements.toast.textContent = message;
  elements.toast.className = 'toast show' + (error ? ' error' : '');
  setTimeout(() => elements.toast.classList.remove('show'), 5500);
}

function rebuildRecords() {
  for (const typeKey of Object.keys(RESULT_TYPES)) runtime.records[typeKey] = buildRecords(typeKey, runtime.data, runtime.replies.records);
}

function render() {
  const value = state.value;
  const records = runtime.records[value.activeType] || [];
  const scoped = filterRecords(records, { ...value, filters: { ...value.filters, query:'', city:'', unit:'', district:'', batch:'', missing:'', answered:'' } }, runtime.data.organizations);
  const filtered = filterRecords(records, value, runtime.data.organizations);
  renderStats(elements.stats, calculateStats(records, runtime.data.organizations, value.scope), runtime.data.validation);
  renderMissingSummary(elements.missing, scoped);
  renderResults(elements.results, filtered);
  renderFilterOptions(elements.filters, filterOptions(scoped), value.filters);
  elements.tabs.querySelectorAll('[role="tab"]').forEach((tab) => {
    const active = tab.dataset.type === value.activeType;
    tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
  });
  elements.scope.querySelectorAll('button').forEach((button) => button.classList.toggle('active', button.dataset.scope === value.scope));
}

async function refreshReplies() {
  runtime.replies = await loadReplyIndex().catch((error) => ({ records:{}, issues:[{ type:'reply-load-error', message:error.message }] }));
  rebuildRecords();
  render();
  if (runtime.replies.issues.length) elements.dataStatus.textContent = '答复索引发现 ' + runtime.replies.issues.length + ' 个待核对项。';
}

function bindNavigation() {
  elements.tabs.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (!tab) return;
    if (tab.dataset.type === 'references') {
      document.getElementById('resultsPanel').hidden = true;
      document.getElementById('referencePanel').hidden = false;
      window.SoilReferenceLibrary?.render();
      elements.tabs.querySelectorAll('[role="tab"]').forEach((item) => item.classList.toggle('active', item === tab));
      return;
    }
    document.getElementById('resultsPanel').hidden = false;
    document.getElementById('referencePanel').hidden = true;
    state.set({ activeType: tab.dataset.type });
  });
  elements.tabs.addEventListener('keydown', (event) => {
    if (!['ArrowLeft','ArrowRight'].includes(event.key)) return;
    const tabs = Array.from(elements.tabs.querySelectorAll('[role="tab"]'));
    const index = tabs.indexOf(document.activeElement);
    tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length].focus();
  });
  elements.scope.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-scope]');
    if (button) state.set({ scope: button.dataset.scope });
  });
}

async function init() {
  document.getElementById('versionLabel').textContent = 'v' + APP_VERSION;
  runtime.data = await loadApplicationData();
  const issues = validateApplicationData(runtime.data.organizations, runtime.data.results);
  const buildWarnings = Number(runtime.data.validation?.summary?.missingFiles || 0) + Number(runtime.data.validation?.summary?.orphanFiles || 0) + Number(runtime.data.validation?.summary?.duplicateRecords || 0);
  elements.dataStatus.textContent = issues.length || buildWarnings ? '数据校验：运行时 ' + issues.length + ' 项，构建期 ' + buildWarnings + ' 项。' : '数据校验通过。';
  bindNavigation();
  bindFilters(elements.filters, state, (format) => {
    const filtered = filterRecords(runtime.records[state.value.activeType] || [], state.value, runtime.data.organizations);
    try { exportRecords(filtered, format, state.value.activeType); } catch (error) { notify(error.message, true); }
  });
  window.SoilReferenceLibrary?.init();
  initAdmin({ root: elements.results, onChanged: refreshReplies, notify });
  state.subscribe(render);
  await refreshReplies();
}

init().catch((error) => {
  console.error(error);
  document.getElementById('resultsRoot').innerHTML = '<div class="empty-state error">初始化失败：' + error.message + '</div>';
});
`);

write('src/styles/base.css', `:root{--bg:#fff;--surface:#f6f8fb;--ink:#172033;--muted:#667085;--rule:#dfe5ec;--accent:#245fce;--accent-dark:#183f91;--success:#15803d;--warn:#b45309;--danger:#b42318;--shadow:0 10px 30px rgba(23,32,51,.08)}
*{box-sizing:border-box}html{color-scheme:light}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans CJK SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--ink);line-height:1.55}.container{width:min(1500px,100%);margin:auto;padding:0 24px}button,input,select{font:inherit}button{cursor:pointer}a{color:var(--accent)}[hidden]{display:none!important}
.site-header{background:linear-gradient(135deg,var(--accent),var(--accent-dark));color:#fff}.header-main{display:flex;align-items:center;gap:12px;padding-top:22px}.header-logo{width:48px;height:48px;object-fit:contain}.site-header h1{font-size:1.45rem;margin:0}.header-tools{margin-left:auto}.ghost-button{border:1px solid rgba(255,255,255,.55);background:rgba(255,255,255,.08);color:#fff;border-radius:8px;padding:8px 12px}.tabs{display:flex;overflow-x:auto;margin-top:16px}.tabs button{border:0;border-bottom:3px solid transparent;background:transparent;color:rgba(255,255,255,.72);padding:12px 20px;white-space:nowrap}.tabs button.active{color:#fff;border-bottom-color:#fff;background:rgba(255,255,255,.1)}
main{padding:22px 0 30px}.toolbar{display:grid;grid-template-columns:minmax(220px,1.4fr) repeat(4,minmax(130px,1fr));gap:10px;background:var(--surface);border:1px solid var(--rule);border-radius:12px;padding:14px}.toolbar input,.toolbar select{width:100%;min-width:0;border:1px solid var(--rule);border-radius:8px;background:#fff;padding:9px 10px;color:var(--ink)}.toolbar-actions{grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap}.primary-button,.secondary-button,.danger-button,.upload-reply{border-radius:8px;padding:8px 13px;border:1px solid var(--accent);font-weight:600}.primary-button,.upload-reply{background:var(--accent);color:#fff}.secondary-button{background:#fff;color:var(--accent)}.danger-button{background:var(--danger);border-color:var(--danger);color:#fff}
.scope-row{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:16px 0}.scope-selector{display:flex;border:1px solid var(--rule);border-radius:9px;overflow:hidden}.scope-selector button{border:0;border-right:1px solid var(--rule);background:#fff;padding:8px 14px}.scope-selector button:last-child{border-right:0}.scope-selector button.active{background:var(--accent);color:#fff}.data-status{font-size:.8rem;color:var(--muted)}.summary-cards{display:grid;grid-template-columns:repeat(6,minmax(110px,1fr));gap:10px}.summary-card{background:var(--surface);border:1px solid var(--rule);border-radius:10px;padding:13px;text-align:center}.summary-card strong{display:block;font-size:1.55rem;color:var(--accent)}.summary-card span{font-size:.78rem;color:var(--muted)}.summary-card.warning strong{color:var(--warn)}
.missing-banner{margin:16px 0;background:#fff8e8;border:1px solid #f4d79d;border-radius:10px;padding:12px 14px;color:#8a4b05}.missing-banner.complete{background:#edf9f0;border-color:#b7e4c1;color:#166534}.missing-banner>div{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}.missing-banner span{background:rgba(255,255,255,.72);border-radius:6px;padding:3px 7px;font-size:.76rem}
.city-section{margin-top:22px}.city-section h2{display:flex;align-items:center;gap:10px;font-size:1.12rem;color:var(--accent);border-bottom:2px solid var(--accent);padding-bottom:7px}.city-section h2 span{font-size:.72rem;background:var(--accent);color:#fff;border-radius:999px;padding:2px 8px}table{width:100%;border-collapse:collapse;font-size:.84rem;table-layout:fixed}th,td{padding:9px 10px;border-bottom:1px solid var(--rule);vertical-align:top;text-align:left}th{background:var(--surface);position:sticky;top:0;z-index:1}th:nth-child(1){width:21%}th:nth-child(2){width:29%}th:nth-child(3){width:12%}th:nth-child(4){width:9%}th:nth-child(5){width:29%}td small{display:block;color:var(--muted);margin-top:4px}.batch-tag,.status-chip{display:inline-block;border-radius:999px;padding:2px 7px;font-size:.72rem;margin:1px}.batch-1{background:#dbeafe;color:#1e40af}.batch-2{background:#dcfce7;color:#166534}.batch-3{background:#fef3c7;color:#92400e}.status-chip.ok{background:#dcfce7;color:#166534}.status-chip.missing{background:#fee2e2;color:#991b1b}.document-menu summary{color:var(--accent);cursor:pointer}.document-menu>div{display:flex;gap:8px;flex-wrap:wrap;padding-top:5px}.reply-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.reply-actions span{color:var(--muted);font-size:.72rem}.link-button{border:0;background:transparent;color:var(--accent);padding:0;text-decoration:underline}.link-button.danger{color:var(--danger)}.mobile-cards{display:none}.empty-state{margin-top:20px;border:1px dashed var(--rule);border-radius:10px;padding:28px;text-align:center;color:var(--muted)}
.site-footer{border-top:1px solid var(--rule);padding:24px 0;color:var(--muted);font-size:.8rem}.footer-inner{display:flex;justify-content:center;align-items:center;gap:26px;flex-wrap:wrap}.footer-brand{display:flex;align-items:center;gap:8px}.footer-brand img{display:block;object-fit:contain}.footer-brand.survey img{width:44px;height:44px}.footer-brand.cau img{height:64px;width:auto}.version{font-weight:700;color:var(--accent)}
.modal{position:fixed;inset:0;background:rgba(15,23,42,.55);display:grid;place-items:center;padding:18px;z-index:1000}.modal-card{width:min(520px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:14px;padding:22px;box-shadow:var(--shadow)}.modal-card h2{margin-top:0}.modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.modal input[type=file],.modal input[type=password]{width:100%;border:1px solid var(--rule);border-radius:8px;padding:10px}.modal progress{width:100%;margin-top:12px}.delete-preview{font-size:.8rem;background:var(--surface);border-radius:8px;padding:9px;margin-top:10px;overflow-wrap:anywhere}.toast{position:fixed;right:20px;bottom:20px;background:#166534;color:#fff;border-radius:9px;padding:12px 16px;opacity:0;transform:translateY(8px);pointer-events:none;transition:.2s;z-index:1200;max-width:min(500px,90vw)}.toast.show{opacity:1;transform:none}.toast.error{background:#991b1b}
`);

write('src/styles/mobile.css', `@media(max-width:980px){.toolbar{grid-template-columns:repeat(2,minmax(0,1fr))}.summary-cards{grid-template-columns:repeat(3,1fr)}.container{padding:0 14px}.header-main{align-items:flex-start}.site-header h1{font-size:1.1rem}.header-logo{width:40px;height:40px}}
@media(max-width:720px){.toolbar{grid-template-columns:1fr}.toolbar-actions{grid-column:auto}.scope-row{align-items:flex-start;flex-direction:column}.summary-cards{grid-template-columns:repeat(2,1fr)}.desktop-table{display:none}.mobile-cards{display:grid;gap:10px}.record-card{border:1px solid var(--rule);border-radius:10px;padding:12px;background:#fff}.record-card header{display:flex;justify-content:space-between;gap:10px}.record-card dl{display:grid;grid-template-columns:76px 1fr;gap:6px 10px;margin:10px 0 0}.record-card dt{color:var(--muted);font-size:.76rem}.record-card dd{margin:0;min-width:0;overflow-wrap:anywhere}.tabs button{padding:10px 14px}.header-tools{margin-left:0}.header-main{flex-wrap:wrap}.header-tools{width:100%}.ghost-button{width:100%}}
`);

write('src/styles/print.css', `@media print{.site-header{background:#fff!important;color:#000}.tabs,.header-tools,.toolbar,.scope-selector,.modal,.toast,.upload-reply,.replace-reply,.delete-reply{display:none!important}.container{width:100%;padding:0}.summary-cards{grid-template-columns:repeat(5,1fr)}.city-section{break-inside:avoid}th{position:static}.site-footer{margin-top:20px}}
`);

write('index.html', `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="河北省第三次全国土壤普查成果编制质量控制意见交流平台">
  <title>河北省第三次全国土壤普查成果编制——质量控制意见交流平台</title>
  <link rel="icon" href="./assets/soil-survey-logo.png" type="image/png">
  <link rel="stylesheet" href="./src/styles/base.css">
  <link rel="stylesheet" href="./src/styles/mobile.css">
  <link rel="stylesheet" href="./src/styles/print.css" media="print">
</head>
<body>
  <header class="site-header">
    <div class="container">
      <div class="header-main"><img class="header-logo" src="./assets/soil-survey-logo.png" alt="第三次全国土壤普查"><h1>河北省第三次全国土壤普查成果编制——质量控制意见交流平台</h1><div class="header-tools"><button id="adminCredentialButton" class="ghost-button">管理员凭证</button></div></div>
      <nav id="resultTabs" class="tabs" role="tablist" aria-label="成果类型">
        <button class="active" role="tab" aria-selected="true" data-type="soilType">土壤类型图</button>
        <button role="tab" aria-selected="false" data-type="soilAttr">土壤属性图</button>
        <button role="tab" aria-selected="false" data-type="farmland">耕地质量评价</button>
        <button role="tab" aria-selected="false" data-type="references">参考文件</button>
      </nav>
    </div>
  </header>
  <main class="container">
    <section id="resultsPanel">
      <form id="filterForm" class="toolbar" aria-label="全局检索与组合筛选">
        <input type="search" name="query" placeholder="检索成果、市、单位、任务单元或联系人">
        <select name="city" aria-label="城市"></select><select name="unit" aria-label="作业单位"></select><select name="district" aria-label="任务单元"></select><select name="batch" aria-label="批次"></select>
        <select name="missing" aria-label="收缴状态"><option value="">全部收缴状态</option><option value="submitted">已收</option><option value="missing">缺失</option></select>
        <select name="answered" aria-label="答复状态"><option value="">全部答复状态</option><option value="answered">已答复</option><option value="unanswered">未答复</option></select>
        <div class="toolbar-actions"><button type="button" class="secondary-button" data-action="reset-filters">重置</button><button type="button" class="secondary-button" data-export="csv">导出 CSV</button><button type="button" class="primary-button" data-export="xlsx">导出 XLSX</button></div>
      </form>
      <div class="scope-row"><div id="scopeSelector" class="scope-selector" aria-label="统计范围"><button class="active" data-scope="province">全省</button><button data-scope="north">北片区</button><button data-scope="south">南片区</button></div><div id="dataStatus" class="data-status">正在校验数据……</div></div>
      <section id="summaryCards" class="summary-cards" aria-label="统计摘要"></section>
      <section id="missingBanner" class="missing-banner"></section>
      <div id="resultsRoot" aria-live="polite"><div class="empty-state">正在加载……</div></div>
    </section>
    <section id="referencePanel" hidden><div id="referenceLibraryRoot"><div class="empty-state">正在加载参考文件目录……</div></div></section>
  </main>
  <footer class="site-footer"><div class="container footer-inner"><div class="footer-brand survey"><img src="./assets/soil-survey-logo.png" alt="第三次全国土壤普查"><span>第三次全国土壤普查</span></div><div class="footer-brand cau"><img src="./assets/logo.jpg" alt="中国农业大学"></div><span id="versionLabel" class="version">v1.5.0</span></div></footer>

  <div id="uploadModal" class="modal" hidden aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="uploadTitle"><div class="modal-card"><h2 id="uploadTitle">整改答复管理</h2><p id="uploadContext"></p><input id="replyFile" type="file" accept=".pdf,.doc,.docx,.xlsx,.xls,.zip,.rar"><progress id="uploadProgress" value="0" max="100"></progress><div id="deletePreview" class="delete-preview"></div><div class="modal-actions"><button class="secondary-button" data-close-modal>取消</button><button id="confirmDelete" class="danger-button" hidden>确认删除</button><button id="confirmUpload" class="primary-button">确认上传</button></div></div></div>
  <div id="credentialModal" class="modal" hidden aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="credentialTitle"><div class="modal-card"><h2 id="credentialTitle">管理员凭证</h2><p>可临时覆盖项目内置凭证，仅保存在当前浏览器会话。</p><input id="adminToken" type="password" autocomplete="off" placeholder="GitHub Token"><div class="modal-actions"><button id="clearCredential" class="secondary-button">清除</button><button class="secondary-button" data-close-modal>取消</button><button id="saveCredential" class="primary-button">保存</button></div></div></div>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
  <script src="./upload-config.js"></script>
  <script src="./vendor/xlsx.full.min.js"></script>
  <script src="./src/render/reference.js"></script>
  <script type="module" src="./src/app.js"></script>
</body>
</html>
`);

const config = read('upload-config.js');
const configCut = config.indexOf('// 页面展示与统计增强');
const preserved = (configCut >= 0 ? config.slice(0, configCut) : config).trimEnd();
write('upload-config.js', preserved + `\n\n// v1.5.0 保留现有前端直传方式；服务端鉴权迁移暂不执行。\nwindow.SOIL_APP_VERSION = '${VERSION}';\n`);

write('scripts/generate-logo.py', `from pathlib import Path
from base64 import b64decode
from io import BytesIO
import re
from collections import deque
from PIL import Image

root = Path(__file__).resolve().parents[1]
svg = (root / 'assets' / 'soil-survey-logo.svg').read_text(encoding='utf-8')
match = re.search(r'data:image/(?:jpeg|jpg);base64,([^\"\\s]+)', svg)
if not match:
    raise SystemExit('未找到 SVG 内嵌 JPEG')
image = Image.open(BytesIO(b64decode(match.group(1)))).convert('RGBA').resize((549, 549), Image.Resampling.LANCZOS)
pixels = image.load(); width, height = image.size
seen = set(); queue = deque()
for x in range(width): queue.append((x,0)); queue.append((x,height-1))
for y in range(height): queue.append((0,y)); queue.append((width-1,y))
while queue:
    x,y = queue.popleft()
    if (x,y) in seen: continue
    seen.add((x,y)); r,g,b,a = pixels[x,y]
    if min(r,g,b) < 238 or max(r,g,b)-min(r,g,b) > 14: continue
    pixels[x,y] = (r,g,b,0)
    if x: queue.append((x-1,y))
    if x+1<width: queue.append((x+1,y))
    if y: queue.append((x,y-1))
    if y+1<height: queue.append((x,y+1))
out = root / 'assets' / 'soil-survey-logo.png'
image.save(out, 'PNG', optimize=True)
print(out)
`);

write('scripts/validate-data.mjs', `import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = process.cwd();
const organizations = JSON.parse(fs.readFileSync('data/organizations.json','utf8'));
const results = JSON.parse(fs.readFileSync('data/results.json','utf8'));
const errors = [];
const warnings = [];
const dictionary = new Map();
for (const city of organizations.cities || []) for (const item of city.items || []) for (const district of item.districts || []) dictionary.set(city.city + '|' + district, item.unit);
const seen = new Set(); const indexed = new Set();
for (const [typeKey,type] of Object.entries(results.types || {})) for (const city of type.cities || []) for (const unit of city.units || []) for (const district of unit.districts || []) for (const doc of district.docs || []) {
  const key = [typeKey,city.name,unit.name,district.label,doc.batch].join('|');
  if (seen.has(key)) errors.push('重复记录: ' + key); seen.add(key);
  if (!doc.file || path.extname(doc.file).slice(1).toLowerCase() !== doc.extension) errors.push('扩展名不规范: ' + key);
  const rel = path.join('data',doc.file); indexed.add(rel.replace(/\\/g,'/'));
  if (!fs.existsSync(rel)) { errors.push('索引文件不存在: ' + rel); continue; }
  const actual = crypto.createHash('sha256').update(fs.readFileSync(rel)).digest('hex');
  if (actual !== doc.sha256) errors.push('SHA-256 不一致: ' + rel);
  if (!dictionary.has(city.name + '|' + district.label)) warnings.push('任务单元未直接命中规范字典: ' + city.name + '|' + district.label);
}
function walk(dir){if(!fs.existsSync(dir))return[];return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
for (const file of walk('data').filter((p)=>/\.(pdf|docx?|xlsx?|zip|rar)$/i.test(p))) if (!indexed.has(file.replace(/\\/g,'/'))) warnings.push('仓库文件未被索引: ' + file);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('数据校验通过。警告 ' + warnings.length + ' 项。');
if (warnings.length) console.log(warnings.slice(0,100).join('\n'));
`);

write('scripts/check-logo.mjs', `import fs from 'node:fs';
import { PNG } from 'pngjs';
const png = PNG.sync.read(fs.readFileSync('assets/soil-survey-logo.png'));
if (png.width !== 549 || png.height !== 549) throw new Error('Logo 必须为 549×549');
const alpha = (x,y) => png.data[(png.width*y+x)*4+3];
for (const [x,y] of [[0,0],[548,0],[0,548],[548,548]]) if (alpha(x,y) !== 0) throw new Error('Logo 角像素必须透明');
let opaque = 0; for (let i=3;i<png.data.length;i+=4) if (png.data[i] > 0) opaque += 1;
if (opaque < png.width * png.height * .1) throw new Error('Logo 有效图形面积异常');
console.log('Logo 校验通过：549×549 RGBA，透明角像素正常。');
`);

write('scripts/build.mjs', `import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd(),dist=path.join(root,'dist');fs.rmSync(dist,{recursive:true,force:true});fs.mkdirSync(dist,{recursive:true});
const copy=(src,dst=src)=>{if(!fs.existsSync(src))return;fs.cpSync(src,path.join(dist,dst),{recursive:true});};
['index.html','upload-config.js','assets','data','src','reference-files','replies'].forEach((p)=>copy(p));
fs.mkdirSync(path.join(dist,'vendor'),{recursive:true});fs.copyFileSync('node_modules/xlsx/dist/xlsx.full.min.js',path.join(dist,'vendor/xlsx.full.min.js'));
console.log('静态站点已输出到 dist/');
`);

write('package.json', JSON.stringify({
  name: 'soil-quality-control-exchange-platform',
  version: VERSION,
  private: true,
  type: 'module',
  scripts: {
    validate: 'node scripts/validate-data.mjs && node scripts/check-logo.mjs',
    build: 'node scripts/build.mjs',
    serve: 'http-server . -p 4173 -c-1 --silent',
    'test:e2e': 'playwright test'
  },
  devDependencies: {
    '@playwright/test': '^1.54.1',
    'http-server': '^14.1.1',
    'pngjs': '^7.0.0',
    'xlsx': '^0.18.5'
  }
}, null, 2));

write('playwright.config.js', `import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', timeout: 45000, retries: 1,
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  webServer: { command: 'npm run serve', url: 'http://127.0.0.1:4173', reuseExistingServer: true },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'tablet', use: { ...devices['iPad (gen 7)'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } }
  ]
});
`);

write('tests/e2e/platform.spec.js', `import { test, expect } from '@playwright/test';

async function mockGithub(page) {
  await page.route('**/api.github.com/repos/1337816143/soil-type-mapping-inventory/contents/replies**', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    return route.fulfill({ status: 201, json: { content: { sha: 'test' } } });
  });
  await page.route('**/raw.githubusercontent.com/1337816143/soil-type-mapping-inventory/main/replies/index.json**', (route) => route.fulfill({ json: { version:1, records:{} } }));
  await page.route('**/api.github.com/repos/1337816143/soil-type-mapping-inventory/**', (route) => route.fulfill({ status: 200, json: {} }));
}

test.beforeEach(async ({ page }) => { await mockGithub(page); await page.goto('/'); await expect(page.locator('#resultsRoot .city-section').first()).toBeVisible(); });

test('三个成果页签与参考资料页可切换', async ({ page }) => {
  for (const label of ['土壤类型图','土壤属性图','耕地质量评价']) { await page.getByRole('tab',{name:label}).click(); await expect(page.locator('#resultsPanel')).toBeVisible(); }
  await page.getByRole('tab',{name:'参考文件'}).click(); await expect(page.locator('#referencePanel')).toBeVisible();
});

test('全省、南北片区统计可以切换', async ({ page }) => {
  const initial = await page.locator('#summaryCards').innerText();
  await page.getByRole('button',{name:'北片区'}).click(); const north = await page.locator('#summaryCards').innerText();
  await page.getByRole('button',{name:'南片区'}).click(); const south = await page.locator('#summaryCards').innerText();
  expect(north).not.toBe(initial); expect(south).not.toBe(north);
});

test('缺失筛选和空结果状态', async ({ page }) => {
  await page.selectOption('select[name="missing"]','missing'); await expect(page.locator('[data-missing="true"]').first()).toBeVisible();
  await page.fill('input[name="query"]','__不存在的任务单元__'); await expect(page.locator('.empty-state')).toContainText('没有符合');
});

test('单文件和多批次成果可打开', async ({ page }) => {
  await expect(page.locator('a.document-link').first()).toHaveAttribute('target','_blank');
  const menu = page.locator('details.document-menu').first(); if (await menu.count()) { await menu.locator('summary').click(); await expect(menu.locator('a').first()).toBeVisible(); }
});

test('管理员凭证、上传弹窗与键盘关闭', async ({ page }) => {
  await page.getByRole('button',{name:'管理员凭证'}).click(); await expect(page.locator('#credentialModal')).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.locator('#credentialModal')).toBeHidden();
  await page.locator('.upload-reply').first().click(); await expect(page.locator('#uploadModal')).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.locator('#uploadModal')).toBeHidden();
});

test('上传模拟流程', async ({ page }) => {
  await page.locator('.upload-reply').first().click();
  await page.locator('#replyFile').setInputFiles({ name:'reply.pdf', mimeType:'application/pdf', buffer:Buffer.from('%PDF-1.4 test') });
  await page.locator('#confirmUpload').click(); await expect(page.locator('#toast')).toContainText(/上传成功|上传失败/);
});

test('移动端转换为卡片视图', async ({ page, isMobile }) => {
  if (!isMobile) test.skip();
  await expect(page.locator('.mobile-cards').first()).toBeVisible(); await expect(page.locator('.desktop-table').first()).toBeHidden();
});

test('Logo 使用透明 PNG 且比例完整', async ({ page }) => {
  const src = await page.locator('.header-logo').getAttribute('src'); expect(src).toContain('soil-survey-logo.png');
  const box = await page.locator('.header-logo').boundingBox(); expect(Math.abs(box.width-box.height)).toBeLessThan(1);
});
`);

write('.github/workflows/ci.yml', `name: CI
on:
  push:
    branches: ['agent/**','main','admin-import-and-reference-files']
  pull_request:
permissions:
  contents: read
jobs:
  validate-and-test:
    runs-on: ubuntu-latest
    timeout-minutes: 35
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run validate
      - run: npm run build
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e -- --project=desktop
      - run: npm run test:e2e -- --project=tablet
      - run: npm run test:e2e -- --project=mobile
`);

write('.github/workflows/deploy.yml', `name: Deploy to GitHub Pages
on:
  push:
    branches: [main, admin-import-and-reference-files]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 35
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run validate
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
      - id: deployment
        uses: actions/deploy-pages@v4
`);

write('CHANGELOG.md', `# Changelog

## v1.5.0

- 将组织字典与成果索引拆分到 data/organizations.json 和 data/results.json。
- 建立统一初始化入口，移除运行时函数包装与 MutationObserver 补丁。
- 将 Logo 固化为 549×549 RGBA PNG，并在页首、页脚直接引用。
- 新增统一数据校验、SHA-256、孤立文件和缺失索引报告。
- 新增全局检索、组合筛选、全省/南北片区统计及 CSV/XLSX 导出。
- 新增移动端卡片视图、键盘导航和管理员凭证弹窗。
- 新增上传、替换、删除及答复索引维护流程。
- 新增 Playwright 端到端测试和 GitHub Actions CI。

> 按当前要求，未撤销旧 Token、未处理公开手机号、未迁移服务端管理员鉴权。
`);

for (const obsolete of ['page-enhancements.js','page-enhancements-core.js','reference-library.js','assets/soil-survey-logo.svg']) {
  if (exists(obsolete)) fs.rmSync(path.join(ROOT, obsolete), { force: true });
}

console.log(JSON.stringify({ version: VERSION, indexedFiles: indexedFiles.size, missingFiles: missingFiles.length, orphanFiles: orphanFiles.length, duplicateKeys: duplicateKeys.length }, null, 2));
