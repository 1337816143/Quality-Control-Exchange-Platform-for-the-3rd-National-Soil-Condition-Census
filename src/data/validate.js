export function normalizeDistrictName(value) {
  return String(value || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .replace(/^d{6}(?:[、,，]d{6})*/, '')
    .replace(/[（(].*?[）)]/g, '')
    .replace(/(满族蒙古族自治县|蒙古族满族自治县|回族满族自治县|回族自治县|满族自治县|蒙古族自治县|自治县|县|区|市)$/, '');
}

export function isMunicipalTask(label, city, municipalCities) {
  const task = String(label || '').replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '');
  const cityName = String(city || '').replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '');
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
