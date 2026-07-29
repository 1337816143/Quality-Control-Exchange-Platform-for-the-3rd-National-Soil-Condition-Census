import { CONTENT_REPOSITORY, RESULT_TYPES, encodeRepositoryPath, rawRepositoryUrl } from '../config.js';
import { isDistrictMatched } from '../data/validate.js';

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');
const replyKey = (city, unit, district) => [city, unit, district].join('_');
const batchClass = (batch) => ({ '第一批': 'batch-1', '第二批': 'batch-2', '第二批补充': 'batch-2', '第三批': 'batch-3' }[batch] || '');

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
          typeKey,
          typeLabel: RESULT_TYPES[typeKey],
          city: city.name,
          unit: unit.name,
          district: district.label,
          docs: district.docs || [],
          missing: false,
          reply,
          answered: Boolean(reply),
          contact: '',
          phone: ''
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
          typeKey,
          typeLabel: RESULT_TYPES[typeKey],
          city: city.city,
          unit: item.unit,
          district,
          docs: [],
          missing: true,
          reply,
          answered: Boolean(reply),
          contact: item.contact || '',
          phone: item.phone || ''
        });
      }
    }
  }
  return records;
}

export function filterRecords(records, state, organizations) {
  const scopeCities = new Set((organizations.regions[state.scope] || organizations.regions.province).cities);
  const filters = state.filters;
  const query = filters.query.trim().toLowerCase();
  return records.filter((record) => {
    if (!scopeCities.has(record.city)) return false;
    if (filters.city && record.city !== filters.city) return false;
    if (filters.unit && record.unit !== filters.unit) return false;
    if (filters.district && record.district !== filters.district) return false;
    if (filters.batch && !record.docs.some((doc) => doc.batch === filters.batch)) return false;
    if (filters.missing === 'missing' && !record.missing) return false;
    if (filters.missing === 'submitted' && record.missing) return false;
    if (filters.answered === 'answered' && !record.answered) return false;
    if (filters.answered === 'unanswered' && record.answered) return false;
    if (query && ![record.typeLabel, record.city, record.unit, record.district, record.contact, record.phone].join(' ').toLowerCase().includes(query)) return false;
    return true;
  });
}

function localDataUrl(file) {
  return './data/' + encodeRepositoryPath(file);
}

function documentLinks(record) {
  if (record.missing) return '<span class="status-chip missing">缺失</span>';
  if (record.docs.length === 1) {
    const doc = record.docs[0];
    return '<a class="document-link" target="_blank" rel="noopener noreferrer" href="' + localDataUrl(doc.file) + '">' + escapeHtml(record.district) + '</a>';
  }
  const links = record.docs.map((doc) =>
    '<a target="_blank" rel="noopener noreferrer" href="' + localDataUrl(doc.file) + '">' + escapeHtml(doc.batch) + '</a>'
  ).join('');
  return '<details class="document-menu"><summary>' + escapeHtml(record.district) + ' · ' + record.docs.length + ' 批</summary><div>' + links + '</div></details>';
}

function formatTime(value) {
  const time = String(value || '');
  if (!/^\d{8,14}$/.test(time)) return time;
  return time.slice(0, 4) + '-' + time.slice(4, 6) + '-' + time.slice(6, 8) +
    (time.length >= 12 ? ' ' + time.slice(8, 10) + ':' + time.slice(10, 12) : '');
}

function replyCell(record) {
  const attrs = ' data-city="' + escapeHtml(record.city) + '" data-unit="' + escapeHtml(record.unit) + '" data-district="' + escapeHtml(record.district) + '"';
  if (record.reply) {
    const replyUrl = rawRepositoryUrl(CONTENT_REPOSITORY, CONTENT_REPOSITORY.replyDirectory + '/' + record.reply.file);
    return '<div class="reply-actions">' +
      '<a target="_blank" rel="noopener noreferrer" href="' + replyUrl + '">查看答复</a>' +
      '<span>' + escapeHtml(formatTime(record.reply.time)) + '</span>' +
      '<button type="button" class="link-button replace-reply"' + attrs + '>替换</button>' +
      '<button type="button" class="link-button danger delete-reply"' + attrs + '>删除</button>' +
      '</div>';
  }
  return '<button type="button" class="upload-reply"' + attrs + '>上传答复</button>';
}

function contactDetails(record, tag = 'small') {
  if (!record.contact && !record.phone) return '';
  const text = [record.contact, record.phone].filter(Boolean).join(' ');
  return '<' + tag + ' class="contact-details">' + escapeHtml(text) + '</' + tag + '>';
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
  const warningCount = Number(validation?.summary?.missingFiles || 0) +
    Number(validation?.summary?.orphanFiles || 0) +
    Number(validation?.summary?.duplicateRecords || 0);
  container.innerHTML = [
    ['应收', stats.expected],
    ['已收', stats.submitted],
    ['缺失', stats.missing],
    ['已答复', stats.answered],
    ['作业单位', stats.units]
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
      return '<tr data-missing="' + record.missing + '">' +
        '<td>' + escapeHtml(record.unit) + '</td>' +
        '<td>' + documentLinks(record) + contactDetails(record) + '</td>' +
        '<td>' + batches + '</td>' +
        '<td>' + status + '</td>' +
        '<td>' + replyCell(record) + '</td>' +
        '</tr>';
    }).join('');

    const cards = cityRecords.map((record) => {
      const contact = contactDetails(record, 'span');
      return '<article class="record-card" data-missing="' + record.missing + '">' +
        '<header><strong>' + escapeHtml(record.district) + '</strong>' +
        (record.missing ? '<span class="status-chip missing">缺失</span>' : '<span class="status-chip ok">已收</span>') +
        '</header><dl>' +
        '<dt>作业单位</dt><dd>' + escapeHtml(record.unit) + '</dd>' +
        '<dt>成果文件</dt><dd>' + documentLinks(record) + '</dd>' +
        '<dt>批次</dt><dd>' + (record.docs.map((doc) => escapeHtml(doc.batch)).join('、') || '—') + '</dd>' +
        (contact ? '<dt>联系人</dt><dd>' + contact + '</dd>' : '') +
        '<dt>整改答复</dt><dd>' + replyCell(record) + '</dd>' +
        '</dl></article>';
    }).join('');

    return '<section class="city-section"><h2>' + escapeHtml(city) + '<span>' + cityRecords.length + ' 条</span></h2>' +
      '<div class="desktop-table"><table><thead><tr><th scope="col">作业单位</th><th scope="col">任务单元/成果</th><th scope="col">批次</th><th scope="col">收缴</th><th scope="col">整改答复</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="mobile-cards">' + cards + '</div></section>';
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
  container.innerHTML = '<strong>缺失 ' + missing.length + ' 个任务单元</strong><div>' +
    missing.slice(0, 40).map((record) => '<span>' + escapeHtml(record.city + '｜' + record.district + '｜' + record.unit) + '</span>').join('') +
    (missing.length > 40 ? '<span>其余 ' + (missing.length - 40) + ' 条请导出查看</span>' : '') +
    '</div>';
}

export function filterOptions(records) {
  const unique = (key) => Array.from(new Set(records.map((record) => record[key]).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  return {
    cities: unique('city'),
    units: unique('unit'),
    districts: unique('district'),
    batches: Array.from(new Set(records.flatMap((record) => record.docs.map((doc) => doc.batch)))).sort((a, b) => a.localeCompare(b, 'zh-CN'))
  };
}
