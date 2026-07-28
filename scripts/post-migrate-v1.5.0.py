from pathlib import Path

VALIDATOR = r'''import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const organizations = JSON.parse(fs.readFileSync('data/organizations.json', 'utf8'));
const results = JSON.parse(fs.readFileSync('data/results.json', 'utf8'));
const baseline = JSON.parse(fs.readFileSync('data/validation-report.json', 'utf8'));

const errors = [];
const warnings = [];
const expectedMissing = new Set((baseline.missingFiles || []).map((value) => String(value).replace(/\\/g, '/')));
const expectedOrphans = new Set((baseline.orphanFiles || []).map((value) => String(value).replace(/\\/g, '/')));
const dictionary = new Map();

for (const city of organizations.cities || []) {
  for (const item of city.items || []) {
    for (const district of item.districts || []) dictionary.set(city.city + '|' + district, item.unit);
  }
}

const seen = new Set();
const indexed = new Set();
for (const [typeKey, type] of Object.entries(results.types || {})) {
  for (const city of type.cities || []) {
    for (const unit of city.units || []) {
      for (const district of unit.districts || []) {
        for (const doc of district.docs || []) {
          const key = [typeKey, city.name, unit.name, district.label, doc.batch].join('|');
          if (seen.has(key)) errors.push('重复记录: ' + key);
          seen.add(key);
          if (!doc.file) { errors.push('文件路径为空: ' + key); continue; }
          const extension = path.extname(doc.file).slice(1).toLowerCase();
          if (!doc.extension || extension !== doc.extension) errors.push('扩展名不规范: ' + key + ' -> ' + doc.file);
          const rel = path.join('data', doc.file).replace(/\\/g, '/');
          indexed.add(rel);
          if (!fs.existsSync(rel)) {
            if (expectedMissing.has(rel)) warnings.push('基线缺失文件: ' + rel);
            else errors.push('索引文件不存在且未记录: ' + rel);
            continue;
          }
          const actual = crypto.createHash('sha256').update(fs.readFileSync(rel)).digest('hex');
          if (!doc.sha256) errors.push('缺少 SHA-256: ' + rel);
          else if (actual !== doc.sha256) errors.push('SHA-256 不一致: ' + rel);
          if (!dictionary.has(city.name + '|' + district.label)) warnings.push('任务单元未直接命中规范字典: ' + city.name + '|' + district.label);
        }
      }
    }
  }
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const item = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(item) : [item];
  });
}

for (const file of walk('data').filter((value) => /\.(pdf|docx?|xlsx?|zip|rar)$/i.test(value))) {
  const normalized = file.replace(/\\/g, '/');
  if (indexed.has(normalized)) continue;
  if (expectedOrphans.has(normalized)) warnings.push('基线孤立文件: ' + normalized);
  else errors.push('仓库文件未被索引且未记录: ' + normalized);
}
for (const missing of expectedMissing) if (!indexed.has(missing)) errors.push('缺失报告中的文件已不在索引: ' + missing);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('数据校验通过。基线告警 ' + warnings.length + ' 项。');
if (warnings.length) console.log(warnings.slice(0, 100).join('\n'));
'''

Path('scripts/validate-data.mjs').write_text(VALIDATOR, encoding='utf-8')

data_index = Path('src/data/index.js')
text = data_index.read_text(encoding='utf-8')
text = text.replace("fetchJson(DATA_URLS.referenceArchive, null)", "fetchJson(DATA_URLS.referenceArchive, {parts: []})")
data_index.write_text(text, encoding='utf-8')

print('Applied stable validator and optional reference archive fallback.')
