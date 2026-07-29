export function createState(initial = {}) {
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
