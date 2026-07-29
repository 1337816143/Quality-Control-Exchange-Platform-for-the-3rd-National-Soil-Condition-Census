const escapeHtml = (value) => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

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
