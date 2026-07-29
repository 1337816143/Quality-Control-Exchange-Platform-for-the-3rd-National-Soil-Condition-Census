import { CONTENT_REPOSITORY, DATA_URLS, rawRepositoryUrl } from '../config.js';

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
  const [organizations, results, validation, referenceManifest] = await Promise.all([
    fetchJson(DATA_URLS.organizations),
    fetchJson(DATA_URLS.results),
    fetchJson(DATA_URLS.validation, { summary: {}, missingFiles: [], orphanFiles: [], duplicateKeys: [] }),
    fetchJson(DATA_URLS.referenceManifest, { fileCount: 0, categories: [] })
  ]);
  return { organizations, results, validation, referenceManifest };
}

export function parseReplyFile(file) {
  const match = String(file?.name || '').match(/^(.*)_整改答复_(\d{14})\.([a-z0-9]+)$/i);
  if (!match) return null;
  return {
    key: match[1],
    file: file.name,
    time: match[2],
    extension: match[3].toLowerCase(),
    sha: file.sha || '',
    size: Number.isFinite(file.size) ? file.size : null
  };
}

export async function loadReplyIndex() {
  const { owner, repo, branch, replyDirectory, replyIndexPath } = CONTENT_REPOSITORY;
  const indexUrl = rawRepositoryUrl(CONTENT_REPOSITORY, replyIndexPath);
  const directoryUrl = 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + replyDirectory + '?ref=' + encodeURIComponent(branch);
  const [stored, files] = await Promise.all([
    fetchJson(indexUrl, { records: {} }),
    fetchJson(directoryUrl, [])
  ]);

  const storedRecords = stored?.records || {};
  const actual = new Map();
  for (const file of Array.isArray(files) ? files : []) {
    const parsed = parseReplyFile(file);
    if (!parsed) continue;
    const previous = actual.get(parsed.key);
    if (!previous || parsed.time > previous.time) actual.set(parsed.key, parsed);
  }

  const records = {};
  const issues = [];
  for (const [key, storedRecord] of Object.entries(storedRecords)) {
    const actualRecord = actual.get(key);
    if (!actualRecord) {
      issues.push({ type: 'stale-index', key, record: storedRecord });
      continue;
    }
    if (actualRecord.file !== storedRecord.file) issues.push({ type: 'stale-index', key, record: storedRecord, actual: actualRecord });
  }
  for (const [key, actualRecord] of actual) {
    const storedRecord = storedRecords[key];
    if (!storedRecord || storedRecord.file !== actualRecord.file) issues.push({ type: 'unindexed-file', key, record: actualRecord });
    const merged = { ...(storedRecord || {}), ...actualRecord };
    if (storedRecord && storedRecord.file !== actualRecord.file) delete merged.sha256;
    records[key] = merged;
  }

  return { records, issues, files: Array.from(actual.values()) };
}
