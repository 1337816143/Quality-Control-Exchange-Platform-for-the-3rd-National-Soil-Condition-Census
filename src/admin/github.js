import { CONTENT_REPOSITORY } from '../config.js';

function headers(token) {
  return {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };
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
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes) {
  let binary = '';
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + step, bytes.length)));
  }
  return btoa(binary);
}

function base64ToText(value) {
  const binary = atob(String(value || '').replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function textToBase64(value) {
  return bytesToBase64(new TextEncoder().encode(value));
}

function replyTimestamp(date = new Date()) {
  return date.toISOString().replace(/\D/g, '').slice(0, 14);
}

function uniqueReplyTimestamp(files, date = new Date()) {
  const names = new Set(files.map((file) => file.name));
  const cursor = new Date(date);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const value = replyTimestamp(cursor);
    if (![...names].some((name) => name.includes('_整改答复_' + value + '.'))) return value;
    cursor.setUTCSeconds(cursor.getUTCSeconds() + 1);
  }
  throw new Error('无法生成唯一的答复文件时间戳');
}

export async function uploadReply({ city, unit, district, file, onProgress }) {
  const token = readToken();
  if (!token) throw new Error('未配置管理员凭证');

  const extension = String(file.name || '').split('.').pop().toLowerCase();
  const key = [city, unit, district].join('_');
  const previousFiles = await listReplyFiles(key);
  const time = uniqueReplyTimestamp(previousFiles);
  const name = key + '_整改答复_' + time + '.' + extension;
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取文件'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 45));
    };
    reader.readAsDataURL(file);
  });
  const sha256 = await fileSha256(file);
  let uploaded = false;

  try {
    onProgress?.(55);
    await githubRequest('/contents/' + CONTENT_REPOSITORY.replyDirectory + '/' + encodeURIComponent(name), token, {
      method: 'PUT',
      body: JSON.stringify({ message: '整改答复: ' + key, content: base64, branch: CONTENT_REPOSITORY.branch })
    });
    uploaded = true;
    onProgress?.(80);
    await updateReplyIndex(token, (records) => {
      records[key] = { key, file: name, time, extension, size: file.size, sha256, updatedAt: new Date().toISOString() };
    });
  } catch (error) {
    if (uploaded) {
      const uploadedFile = (await listReplyFiles(key).catch(() => [])).find((item) => item.name === name);
      if (uploadedFile) {
        await githubRequest('/contents/' + CONTENT_REPOSITORY.replyDirectory + '/' + encodeURIComponent(name), token, {
          method: 'DELETE',
          body: JSON.stringify({ message: '回滚失败的整改答复上传: ' + key, sha: uploadedFile.sha, branch: CONTENT_REPOSITORY.branch })
        }).catch(() => {});
      }
    }
    throw error;
  }

  const replaced = [];
  const cleanupErrors = [];
  for (const previous of previousFiles.filter((item) => item.name !== name)) {
    try {
      await githubRequest('/contents/' + CONTENT_REPOSITORY.replyDirectory + '/' + encodeURIComponent(previous.name), token, {
        method: 'DELETE',
        body: JSON.stringify({ message: '替换整改答复: ' + key, sha: previous.sha, branch: CONTENT_REPOSITORY.branch })
      });
      replaced.push(previous.name);
    } catch (error) {
      cleanupErrors.push({ file: previous.name, message: error.message });
    }
  }

  onProgress?.(100);
  return { key, file: name, time, extension, size: file.size, sha256, replaced, cleanupErrors };
}

async function getReplyIndex(token) {
  try {
    const result = await githubRequest('/contents/' + CONTENT_REPOSITORY.replyIndexPath + '?ref=' + encodeURIComponent(CONTENT_REPOSITORY.branch), token);
    return { sha: result.sha, data: JSON.parse(base64ToText(result.content)) };
  } catch (error) {
    if (/404|Not Found/i.test(error.message)) return { sha: null, data: { version: 1, records: {} } };
    throw error;
  }
}

async function updateReplyIndex(token, mutator, attempt = 0) {
  const current = await getReplyIndex(token);
  const records = { ...(current.data.records || {}) };
  mutator(records);
  const data = { version: 1, updatedAt: new Date().toISOString(), records };
  const body = {
    message: 'chore: update reply index',
    content: textToBase64(JSON.stringify(data, null, 2)),
    branch: CONTENT_REPOSITORY.branch
  };
  if (current.sha) body.sha = current.sha;
  try {
    await githubRequest('/contents/' + CONTENT_REPOSITORY.replyIndexPath, token, { method: 'PUT', body: JSON.stringify(body) });
  } catch (error) {
    if (attempt === 0 && /409|conflict|does not match/i.test(error.message)) return updateReplyIndex(token, mutator, 1);
    throw error;
  }
}

export async function listReplyFiles(key) {
  const token = readToken();
  if (!token) throw new Error('未配置管理员凭证');
  const files = await githubRequest('/contents/' + CONTENT_REPOSITORY.replyDirectory + '?ref=' + encodeURIComponent(CONTENT_REPOSITORY.branch), token);
  return (Array.isArray(files) ? files : []).filter((file) => file.type === 'file' && file.name.startsWith(key + '_整改答复_'));
}

export async function deleteReplies({ city, unit, district }) {
  const token = readToken();
  if (!token) throw new Error('未配置管理员凭证');
  const key = [city, unit, district].join('_');
  const files = await listReplyFiles(key);
  for (const file of files) {
    await githubRequest('/contents/' + CONTENT_REPOSITORY.replyDirectory + '/' + encodeURIComponent(file.name), token, {
      method: 'DELETE',
      body: JSON.stringify({ message: '删除整改答复: ' + key, sha: file.sha, branch: CONTENT_REPOSITORY.branch })
    });
  }
  await updateReplyIndex(token, (records) => { delete records[key]; });
  const remaining = await listReplyFiles(key);
  if (remaining.length) throw new Error('删除后校验失败，仍有 ' + remaining.length + ' 个答复文件');
  return { key, deleted: files.map((file) => file.name), verified: true };
}
