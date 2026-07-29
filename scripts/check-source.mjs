import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const index = read('index.html');
const sourceFiles = [
  'src/app.js',
  'src/config.js',
  'src/data/index.js',
  'src/admin/github.js',
  'src/admin/index.js',
  'src/render/reference.js',
  'src/render/results.js'
];
const source = sourceFiles.map(read).join('\n');

assert((index.match(/data-type="references"/g) || []).length === 1, '参考文件页签必须且只能存在一个');
assert(!index.includes('soil-survey-logo.svg'), '页面不得引用旧 SVG Logo');
assert(!index.includes('page-enhancements'), '页面不得加载旧增强脚本');
assert(!index.includes('reference-library.js'), '页面不得加载旧参考资料脚本');
assert(!source.includes('MutationObserver'), 'v1.5.0 不得使用 MutationObserver 运行时补丁');
assert(!source.includes('href="./replies/'), '答复文件不得使用当前站点相对地址');
assert(!source.includes("replace(/D/g"), '答复时间戳必须正确移除非数字字符');
assert(source.includes("\\d{14})\\."), '答复文件解析必须使用 14 位时间戳和转义点号');
assert(source.includes('rawRepositoryUrl(CONTENT_REPOSITORY'), '答复链接必须使用内容仓库原始文件地址');
assert(source.includes('textContent = file.name'), '删除清单文件名必须以 textContent 渲染');

if (failures.length) {
  console.error(failures.map((message) => '源代码校验失败：' + message).join('\n'));
  process.exit(1);
}
console.log('源代码防回归校验通过。');
