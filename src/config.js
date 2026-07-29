export const APP_VERSION = '1.5.0';

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
  replyIndexPath: 'replies/index.json'
};

export const REFERENCE_REPOSITORY = {
  ...CONTENT_REPOSITORY,
  root: 'reference-files/third-soil-survey'
};

export const ALLOWED_REPLY_EXTENSIONS = ['pdf', 'doc', 'docx', 'xlsx', 'xls', 'zip', 'rar'];
export const MAX_REPLY_SIZE = 20 * 1024 * 1024;

export const DATA_URLS = {
  organizations: './data/organizations.json',
  results: './data/results.json',
  validation: './data/validation-report.json',
  referenceManifest: './reference-files/third-soil-survey/manifest.json'
};

export function encodeRepositoryPath(path) {
  return String(path || '').split('/').map(encodeURIComponent).join('/');
}

export function rawRepositoryUrl(repository, path) {
  return 'https://raw.githubusercontent.com/' + repository.owner + '/' + repository.repo + '/' + repository.branch + '/' + encodeRepositoryPath(path);
}
