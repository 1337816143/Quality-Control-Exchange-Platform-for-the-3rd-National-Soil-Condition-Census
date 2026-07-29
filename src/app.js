import { APP_VERSION, RESULT_TYPES } from './config.js';
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
    Promise.resolve(exportRecords(filtered, format, state.value.activeType)).catch((error) => notify(error.message, true));
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
