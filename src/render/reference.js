(function () {
  'use strict';

  var OWNER = '1337816143';
  var REPO = 'soil-type-mapping-inventory';
  var BRANCH = 'main';
  var ROOT = 'reference-files/third-soil-survey';
  var RAW_BASE = './';
  var MANIFEST_URL = ROOT + '/manifest.json';
  var ARCHIVE_META_URL = ROOT + '/archive.json';
  var JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
  var CHUNK_SIZE = 8 * 1024 * 1024;
  var EXPECTED_ARCHIVE_SIZE = 310522366;

  var state = {
    manifest: null,
    archiveMeta: null,
    archiveBytesPromise: null,
    zipPromise: null
  };

  function addReferenceStyles() {
    if (document.getElementById('reference-library-style')) return;
    var style = document.createElement('style');
    style.id = 'reference-library-style';
    style.textContent =
      '.reference-shell{display:flex;flex-direction:column;gap:16px}' +
      '.reference-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--bg2);border:1px solid var(--rule);border-radius:10px;padding:12px}' +
      '.reference-search{flex:1 1 320px;min-width:220px;border:1px solid var(--rule);border-radius:7px;padding:8px 11px;font:inherit;color:var(--ink);background:#fff}' +
      '.reference-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;border:1px solid var(--accent);border-radius:7px;padding:7px 12px;background:var(--accent);color:#fff;font-size:.82rem;font-weight:600;cursor:pointer;text-decoration:none;white-space:nowrap}' +
      '.reference-btn:hover{background:#1d4ed8}.reference-btn.secondary{background:#fff;color:var(--accent)}' +
      '.reference-btn.secondary:hover{background:#eff6ff}.reference-btn:disabled{opacity:.5;cursor:not-allowed}' +
      '.reference-note{font-size:.78rem;color:var(--muted);line-height:1.6;flex:1 1 100%}' +
      '.reference-status{border-radius:8px;padding:9px 12px;font-size:.8rem;line-height:1.6;background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe}' +
      '.reference-status.warn{background:#fffbeb;color:#92400e;border-color:#fde68a}.reference-status.error{background:#fef2f2;color:#991b1b;border-color:#fecaca}' +
      '.reference-progress{height:8px;background:#dbeafe;border-radius:999px;overflow:hidden;margin-top:7px}.reference-progress>span{display:block;height:100%;width:0;background:linear-gradient(90deg,#2563eb,#0ea5e9);transition:width .2s}' +
      '.reference-category{border:1px solid var(--rule);border-radius:10px;background:#fff;overflow:hidden}' +
      '.reference-category summary{display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;padding:12px 14px;background:var(--bg2);font-weight:700;color:var(--ink);list-style:none}' +
      '.reference-category summary::-webkit-details-marker{display:none}.reference-category summary::after{content:"▾";color:var(--muted)}.reference-category:not([open]) summary::after{content:"▸"}' +
      '.reference-count{font-size:.74rem;font-weight:600;color:var(--accent);background:#dbeafe;border-radius:999px;padding:2px 8px;margin-left:auto}' +
      '.reference-files{display:flex;flex-direction:column}' +
      '.reference-file{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 14px;border-top:1px solid var(--rule)}' +
      '.reference-file:first-child{border-top:0}.reference-file:hover{background:#fafcff}' +
      '.reference-file-main{min-width:0}.reference-file-name{font-size:.84rem;font-weight:600;color:var(--ink);overflow-wrap:anywhere}' +
      '.reference-file-meta{display:flex;gap:8px;flex-wrap:wrap;font-size:.72rem;color:var(--muted);margin-top:2px}.reference-file-path{overflow-wrap:anywhere}' +
      '.reference-file-actions{display:flex;gap:6px;align-items:center}.reference-file-actions .reference-btn{padding:5px 9px;font-size:.74rem}' +
      '.reference-empty{padding:18px;text-align:center;color:var(--muted);font-size:.82rem}' +
      '.reference-import{border:1px dashed #93c5fd;border-radius:10px;background:#f8fbff;padding:13px}' +
      '.reference-import-title{font-size:.86rem;font-weight:700;color:#1e40af;margin-bottom:5px}' +
      '.reference-import p{font-size:.77rem;color:var(--muted);line-height:1.7;margin-bottom:8px}' +
      '@media(max-width:760px){.reference-file{grid-template-columns:1fr}.reference-file-actions{justify-content:flex-start}.reference-toolbar{align-items:stretch}.reference-btn{flex:1 1 auto}}';
    document.head.appendChild(style);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatSize(bytes) {
    if (!Number.isFinite(bytes)) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 1 : 2) + ' MB';
  }

  function extensionLabel(ext) {
    var value = String(ext || 'file').toUpperCase();
    return value.length > 5 ? 'FILE' : value;
  }

  function setStatus(message, kind, percent) {
    var box = document.getElementById('referenceStatus');
    if (!box) return;
    box.className = 'reference-status' + (kind ? ' ' + kind : '');
    var progress = '';
    if (typeof percent === 'number') {
      progress = '<div class="reference-progress"><span style="width:' + Math.max(0, Math.min(100, percent)) + '%"></span></div>';
    }
    box.innerHTML = escapeHtml(message) + progress;
    box.style.display = message ? 'block' : 'none';
  }

  function fetchJson(url) {
    return fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now(), {cache: 'no-store'})
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      });
  }

  function installReferenceTab() {
    var tabs = document.querySelector('header .tabs');
    var pageContainer = document.querySelector('body > .container');
    if (!tabs || !pageContainer) return;

    var tab = tabs.querySelector('[data-tab="references"]');
    if (!tab) {
      tab = document.createElement('div');
      tab.className = 'tab';
      tab.dataset.tab = 'references';
      tab.textContent = '参考文件';
      tabs.appendChild(tab);
    }

    var panel = document.getElementById('tab-references');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'tab-references';
      panel.className = 'tab-content';
      panel.innerHTML = '<div class="content" id="referenceLibraryRoot"><div class="reference-empty">正在加载参考文件目录……</div></div>';
      pageContainer.appendChild(panel);
    }

    tab.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      document.querySelectorAll('.tab').forEach(function (item) { item.classList.remove('active'); });
      document.querySelectorAll('.tab-content').forEach(function (item) { item.classList.remove('active'); });
      tab.classList.add('active');
      panel.classList.add('active');
      renderReferenceLibrary();
    });

    document.querySelectorAll('.tab:not([data-tab="references"])').forEach(function (item) {
      item.addEventListener('click', function () {
        tab.classList.remove('active');
        panel.classList.remove('active');
      });
    });
  }

  function renderReferenceLibrary() {
    var root = document.getElementById('referenceLibraryRoot');
    if (!root) return;
    if (!state.manifest) {
      root.innerHTML = '<div class="reference-empty">正在加载参考文件目录……</div>';
      Promise.all([
        fetchJson(MANIFEST_URL),
        fetchJson(ARCHIVE_META_URL).catch(function () { return null; })
      ]).then(function (result) {
        state.manifest = result[0];
        state.archiveMeta = result[1];
        buildReferenceLibrary();
      }).catch(function (error) {
        root.innerHTML = '<div class="reference-status error">参考文件目录加载失败：' + escapeHtml(error.message) + '</div>';
      });
      return;
    }
    buildReferenceLibrary();
  }

  function buildReferenceLibrary() {
    var root = document.getElementById('referenceLibraryRoot');
    if (!root || !state.manifest) return;
    var archiveReady = !!(state.archiveMeta && Array.isArray(state.archiveMeta.parts) && state.archiveMeta.parts.length);
    var canImport = !!window.SOIL_GITHUB_UPLOAD_TOKEN;
    var html = '<div class="reference-shell">' +
      '<div class="reference-toolbar">' +
      '<input id="referenceSearch" class="reference-search" type="search" placeholder="搜索文件名、目录或成果类别">' +
      '<button id="downloadReferenceArchive" class="reference-btn secondary"' + (archiveReady ? '' : ' disabled') + '>下载完整资料包</button>' +
      '<button id="selectReferenceArchive" class="reference-btn"' + (canImport ? '' : ' disabled') + '>管理员导入资料包</button>' +
      '<input id="referenceArchiveInput" type="file" accept=".zip" hidden>' +
      '<div class="reference-note">共 ' + state.manifest.fileCount + ' 个有效参考文件。单个文件下载首次需要载入完整资料包，建议在电脑端操作。</div>' +
      '</div>' +
      '<div id="referenceStatus" class="reference-status ' + (archiveReady ? '' : 'warn') + '">' +
      (archiveReady ? '资料包已存入仓库，可下载完整资料包或提取单个文件。' : '文件目录已建立；完整资料包尚未导入仓库。管理员选择原始 ZIP 后，系统会自动分块并一次提交。') +
      '</div>';

    if (!archiveReady) {
      html += '<div class="reference-import"><div class="reference-import-title">资料包导入说明</div>' +
        '<p>原始 ZIP 约 310 MB，其中包含超过 GitHub 100 MB 单文件上限的 PPTX，因此采用分块存储。导入过程中不会修改其他页面数据，最后只更新一次 main 分支。</p></div>';
    }

    html += '<div id="referenceCategories">';
    state.manifest.categories.forEach(function (category, index) {
      html += '<details class="reference-category" data-category="' + escapeHtml(category.name) + '"' + (index < 3 ? ' open' : '') + '>' +
        '<summary><span>' + escapeHtml(category.name) + '</span><span class="reference-count">' + category.files.length + ' 个文件</span></summary>' +
        '<div class="reference-files">';
      if (!category.files.length) {
        html += '<div class="reference-empty">暂无参考文件</div>';
      } else {
        category.files.forEach(function (file) {
          html += '<div class="reference-file" data-search="' + escapeHtml((category.name + ' ' + file.name + ' ' + file.relativePath).toLowerCase()) + '">' +
            '<div class="reference-file-main"><div class="reference-file-name">' + escapeHtml(file.name) + '</div>' +
            '<div class="reference-file-meta"><span>' + extensionLabel(file.ext) + '</span><span>' + formatSize(file.size) + '</span>' +
            (file.relativePath !== file.name ? '<span class="reference-file-path">' + escapeHtml(file.relativePath) + '</span>' : '') +
            '</div></div>' +
            '<div class="reference-file-actions"><button class="reference-btn secondary reference-file-download" data-path="' + escapeHtml(file.archivePath) + '" data-name="' + escapeHtml(file.name) + '"' + (archiveReady ? '' : ' disabled') + '>下载文件</button></div>' +
            '</div>';
        });
      }
      html += '</div></details>';
    });
    html += '</div></div>';
    root.innerHTML = html;
    bindReferenceEvents();
  }

  function bindReferenceEvents() {
    var search = document.getElementById('referenceSearch');
    if (search) {
      search.addEventListener('input', function () {
        var q = search.value.trim().toLowerCase();
        document.querySelectorAll('.reference-file').forEach(function (row) {
          row.style.display = !q || row.dataset.search.indexOf(q) >= 0 ? '' : 'none';
        });
        document.querySelectorAll('.reference-category').forEach(function (category) {
          var visible = Array.prototype.some.call(category.querySelectorAll('.reference-file'), function (row) {
            return row.style.display !== 'none';
          });
          category.style.display = visible || !category.querySelector('.reference-file') ? '' : 'none';
          if (q && visible) category.open = true;
        });
      });
    }

    var archiveButton = document.getElementById('downloadReferenceArchive');
    if (archiveButton) archiveButton.addEventListener('click', downloadFullArchive);

    document.querySelectorAll('.reference-file-download').forEach(function (button) {
      button.addEventListener('click', function () {
        downloadSingleReference(button.dataset.path, button.dataset.name);
      });
    });

    var selectButton = document.getElementById('selectReferenceArchive');
    var input = document.getElementById('referenceArchiveInput');
    if (selectButton && input) {
      selectButton.addEventListener('click', function () { input.click(); });
      input.addEventListener('change', function () {
        if (input.files && input.files[0]) importReferenceArchive(input.files[0]);
        input.value = '';
      });
    }
  }

  function rawUrl(path) {
    return RAW_BASE + path.split('/').map(encodeURIComponent).join('/');
  }

  function loadArchiveBytes() {
    if (state.archiveBytesPromise) return state.archiveBytesPromise;
    state.archiveBytesPromise = (state.archiveMeta ? Promise.resolve(state.archiveMeta) : fetchJson(ARCHIVE_META_URL))
      .then(function (meta) {
        state.archiveMeta = meta;
        var total = meta.size || 0;
        var output = new Uint8Array(total);
        var offset = 0;
        return meta.parts.reduce(function (chain, part, index) {
          return chain.then(function () {
            setStatus('正在载入资料包 ' + (index + 1) + ' / ' + meta.parts.length, '', Math.round(index / meta.parts.length * 100));
            return fetch(rawUrl(part.path), {cache: 'no-store'}).then(function (response) {
              if (!response.ok) throw new Error('资料分块加载失败：HTTP ' + response.status);
              return response.arrayBuffer();
            }).then(function (buffer) {
              var bytes = new Uint8Array(buffer);
              output.set(bytes, offset);
              offset += bytes.length;
            });
          });
        }, Promise.resolve()).then(function () {
          setStatus('资料包加载完成。', '', 100);
          return output.buffer;
        });
      }).catch(function (error) {
        state.archiveBytesPromise = null;
        setStatus(error.message, 'error');
        throw error;
      });
    return state.archiveBytesPromise;
  }

  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  function downloadFullArchive() {
    loadArchiveBytes().then(function (buffer) {
      saveBlob(new Blob([buffer], {type: 'application/zip'}), state.archiveMeta.fileName || state.manifest.sourceArchive);
    });
  }

  function loadJSZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-reference-jszip]');
      if (existing) {
        existing.addEventListener('load', function () { resolve(window.JSZip); }, {once: true});
        existing.addEventListener('error', function () { reject(new Error('解压组件加载失败')); }, {once: true});
        return;
      }
      var script = document.createElement('script');
      script.src = JSZIP_URL;
      script.dataset.referenceJszip = '1';
      script.onload = function () { resolve(window.JSZip); };
      script.onerror = function () { reject(new Error('解压组件加载失败')); };
      document.head.appendChild(script);
    });
  }

  function getZip() {
    if (state.zipPromise) return state.zipPromise;
    state.zipPromise = Promise.all([loadArchiveBytes(), loadJSZip()]).then(function (result) {
      setStatus('正在解析资料包，请稍候……');
      return result[1].loadAsync(result[0]);
    }).catch(function (error) {
      state.zipPromise = null;
      throw error;
    });
    return state.zipPromise;
  }

  function downloadSingleReference(path, name) {
    getZip().then(function (zip) {
      var item = zip.file(path);
      if (!item) throw new Error('资料包中未找到该文件：' + name);
      setStatus('正在提取：' + name);
      return item.async('blob');
    }).then(function (blob) {
      saveBlob(blob, name);
      setStatus('文件已开始下载：' + name);
    }).catch(function (error) {
      setStatus(error.message, 'error');
    });
  }

  function arrayBufferToBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = '';
    var step = 0x8000;
    for (var i = 0; i < bytes.length; i += step) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + step, bytes.length)));
    }
    return btoa(binary);
  }

  function githubRequest(path, options) {
    var token = window.SOIL_GITHUB_UPLOAD_TOKEN;
    if (!token) return Promise.reject(new Error('未配置 GitHub 上传令牌'));
    var settings = options || {};
    settings.headers = Object.assign({
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }, settings.headers || {});
    return fetch('https://api.github.com/repos/' + OWNER + '/' + REPO + path, settings).then(function (response) {
      return response.text().then(function (text) {
        var data = text ? JSON.parse(text) : {};
        if (!response.ok) throw new Error(data.message || ('GitHub API ' + response.status));
        return data;
      });
    });
  }

  function createGithubBlob(content, encoding) {
    return githubRequest('/git/blobs', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({content: content, encoding: encoding || 'utf-8'})
    });
  }

  function importReferenceArchive(file) {
    if (!window.SOIL_GITHUB_UPLOAD_TOKEN) {
      setStatus('未配置 GitHub 上传令牌，无法导入资料包。', 'error');
      return;
    }
    if (!file || file.size !== EXPECTED_ARCHIVE_SIZE) {
      setStatus('请选择原始文件“三普成果编制及质量控制主要参考资料.zip”（文件大小应为 ' + formatSize(EXPECTED_ARCHIVE_SIZE) + '）。', 'error');
      return;
    }
    if (!confirm('将把该资料包分块写入 GitHub 仓库，并在最后一次性更新 main 分支。是否继续？')) return;

    var baseCommitSha;
    var baseTreeSha;
    var parts = [];
    var count = Math.ceil(file.size / CHUNK_SIZE);

    setStatus('正在读取仓库状态……', '', 1);
    githubRequest('/git/ref/heads/' + BRANCH)
      .then(function (ref) {
        baseCommitSha = ref.object.sha;
        return githubRequest('/git/commits/' + baseCommitSha);
      })
      .then(function (commit) {
        baseTreeSha = commit.tree.sha;
        var chain = Promise.resolve();
        for (var index = 0; index < count; index++) {
          (function (partIndex) {
            chain = chain.then(function () {
              var start = partIndex * CHUNK_SIZE;
              var end = Math.min(file.size, start + CHUNK_SIZE);
              setStatus('正在上传资料分块 ' + (partIndex + 1) + ' / ' + count, '', Math.round(partIndex / count * 85));
              return file.slice(start, end).arrayBuffer().then(function (buffer) {
                return createGithubBlob(arrayBufferToBase64(buffer), 'base64').then(function (blob) {
                  parts.push({
                    path: ROOT + '/archive/part-' + String(partIndex + 1).padStart(3, '0') + '.bin',
                    size: end - start,
                    sha: blob.sha
                  });
                });
              });
            });
          })(index);
        }
        return chain;
      })
      .then(function () {
        var metadata = {
          version: 1,
          fileName: file.name,
          size: file.size,
          expectedSha256: state.manifest.archiveSha256,
          chunkSize: CHUNK_SIZE,
          parts: parts.map(function (part) { return {path: part.path, size: part.size}; }),
          importedAt: new Date().toISOString()
        };
        return createGithubBlob(JSON.stringify(metadata, null, 2), 'utf-8').then(function (metaBlob) {
          var tree = parts.map(function (part) {
            return {path: part.path, mode: '100644', type: 'blob', sha: part.sha};
          });
          tree.push({path: ROOT + '/archive.json', mode: '100644', type: 'blob', sha: metaBlob.sha});
          setStatus('正在生成一次性提交……', '', 90);
          return githubRequest('/git/trees', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({base_tree: baseTreeSha, tree: tree})
          }).then(function (newTree) {
            return githubRequest('/git/commits', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({
                message: 'docs: import third soil survey reference archive',
                tree: newTree.sha,
                parents: [baseCommitSha]
              })
            });
          });
        });
      })
      .then(function (commit) {
        return githubRequest('/git/refs/heads/' + BRANCH, {
          method: 'PATCH',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({sha: commit.sha, force: false})
        });
      })
      .then(function () {
        state.archiveMeta = {
          fileName: file.name,
          size: file.size,
          chunkSize: CHUNK_SIZE,
          parts: parts.map(function (part) { return {path: part.path, size: part.size}; })
        };
        state.archiveBytesPromise = null;
        state.zipPromise = null;
        setStatus('资料包已一次性提交到仓库。GitHub Raw 文件同步可能需要几十秒，稍后即可下载。', '', 100);
        setTimeout(buildReferenceLibrary, 1500);
      })
      .catch(function (error) {
        setStatus('导入失败：' + error.message, 'error');
      });
  }

  function install() {
    addReferenceStyles();
    installReferenceTab();
  }

  window.SoilReferenceLibrary = { init: installReferenceTab, render: renderReferenceLibrary };
})();
