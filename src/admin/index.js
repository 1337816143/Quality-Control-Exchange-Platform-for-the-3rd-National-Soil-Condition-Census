import { ALLOWED_REPLY_EXTENSIONS, MAX_REPLY_SIZE } from '../config.js';
import { deleteReplies, listReplyFiles, readToken, saveSessionToken, uploadReply } from './github.js';

function renderDeletePreview(container, files) {
  container.replaceChildren();
  const title = document.createElement('strong');
  title.textContent = '删除清单：';
  container.appendChild(title);
  if (!files.length) {
    const empty = document.createElement('p');
    empty.textContent = '没有找到可删除的整改答复文件。';
    container.appendChild(empty);
    return;
  }
  const list = document.createElement('ul');
  for (const file of files) {
    const item = document.createElement('li');
    item.textContent = file.name;
    list.appendChild(item);
  }
  container.appendChild(list);
}

export function initAdmin({ root, onChanged, notify }) {
  const uploadModal = document.getElementById('uploadModal');
  const credentialModal = document.getElementById('credentialModal');
  const fileInput = document.getElementById('replyFile');
  const progress = document.getElementById('uploadProgress');
  const confirmUpload = document.getElementById('confirmUpload');
  const confirmDelete = document.getElementById('confirmDelete');
  const deletePreview = document.getElementById('deletePreview');
  let context = null;
  let returnFocus = null;
  let busy = false;

  const close = (modal) => {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    const target = returnFocus;
    returnFocus = null;
    target?.focus?.();
  };

  const open = (modal, trigger) => {
    returnFocus = trigger || document.activeElement;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    modal.querySelector('input:not([hidden]),button:not([hidden])')?.focus();
  };

  const setBusy = (value) => {
    busy = value;
    confirmUpload.disabled = value;
    confirmDelete.disabled = value;
    fileInput.disabled = value;
    uploadModal.setAttribute('aria-busy', String(value));
  };

  root.addEventListener('click', async (event) => {
    const action = event.target.closest('.upload-reply,.replace-reply,.delete-reply');
    if (!action || busy) return;
    context = { city: action.dataset.city, unit: action.dataset.unit, district: action.dataset.district };
    document.getElementById('uploadContext').textContent = context.city + '｜' + context.unit + '｜' + context.district;
    fileInput.value = '';
    progress.value = 0;
    confirmUpload.hidden = action.classList.contains('delete-reply');
    confirmDelete.hidden = !action.classList.contains('delete-reply');
    confirmDelete.disabled = false;
    renderDeletePreview(deletePreview, []);
    open(uploadModal, action);
    if (action.classList.contains('delete-reply')) {
      try {
        const files = await listReplyFiles([context.city, context.unit, context.district].join('_'));
        renderDeletePreview(deletePreview, files);
        confirmDelete.disabled = files.length === 0;
      } catch (error) {
        notify(error.message, true);
      }
    }
  });

  const credentialButton = document.getElementById('adminCredentialButton');
  credentialButton.addEventListener('click', () => {
    document.getElementById('adminToken').value = readToken();
    open(credentialModal, credentialButton);
  });

  document.getElementById('saveCredential').addEventListener('click', () => {
    saveSessionToken(document.getElementById('adminToken').value.trim());
    close(credentialModal);
    window.dispatchEvent(new CustomEvent('soil-admin-token-change'));
    notify('管理员凭证已保存到本次浏览器会话。');
  });

  document.getElementById('clearCredential').addEventListener('click', () => {
    saveSessionToken('');
    document.getElementById('adminToken').value = '';
    window.dispatchEvent(new CustomEvent('soil-admin-token-change'));
    notify('会话凭证已清除。');
  });

  confirmUpload.addEventListener('click', async () => {
    const file = fileInput.files[0];
    if (!file || !context) return notify('请选择文件。', true);
    const ext = String(file.name || '').split('.').pop().toLowerCase();
    if (!ALLOWED_REPLY_EXTENSIONS.includes(ext)) return notify('不支持该文件类型。', true);
    if (file.size > MAX_REPLY_SIZE) return notify('文件不能超过 20 MB。', true);
    setBusy(true);
    try {
      const result = await uploadReply({ ...context, file, onProgress: (value) => { progress.value = value; } });
      close(uploadModal);
      if (result.cleanupErrors.length) notify('上传成功，但有 ' + result.cleanupErrors.length + ' 个旧文件未能清理，请稍后重试替换。', true);
      else notify('上传成功！稍等3~5分钟刷新网站即可查看新上传的文件');
      await onChanged();
    } catch (error) {
      notify('上传失败：' + error.message, true);
    } finally {
      setBusy(false);
    }
  });

  confirmDelete.addEventListener('click', async () => {
    if (!context || !confirm('确认删除清单中的整改答复文件？此操作不可撤销。')) return;
    setBusy(true);
    try {
      const result = await deleteReplies(context);
      close(uploadModal);
      notify('已删除 ' + result.deleted.length + ' 个文件，删除后校验通过。');
      await onChanged();
    } catch (error) {
      notify('删除失败：' + error.message, true);
    } finally {
      setBusy(false);
    }
  });

  document.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', () => close(button.closest('.modal'))));
  document.querySelectorAll('.modal').forEach((modal) => modal.addEventListener('click', (event) => {
    if (event.target === modal && !busy) close(modal);
  }));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !busy) document.querySelectorAll('.modal:not([hidden])').forEach(close);
  });
}
