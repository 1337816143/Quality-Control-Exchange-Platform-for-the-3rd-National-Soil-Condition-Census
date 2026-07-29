function rows(records) {
  return records.map((record) => ({
    '成果类型': record.typeLabel,
    '市': record.city,
    '作业单位': record.unit,
    '任务单元': record.district,
    '应收': '是',
    '已收': record.missing ? '否' : '是',
    '缺失': record.missing ? '是' : '否',
    '批次': record.docs.map((doc) => doc.batch).join('、'),
    '已答复': record.answered ? '是' : '否',
    '答复时间': record.reply?.time || '',
    '联系人': record.contact || '',
    '联系电话': record.phone || '',
    '成果摘要': record.docs.map((doc) => doc.sha256 ? doc.sha256.slice(0, 12) : '').filter(Boolean).join('、')
  }));
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportRecords(records, format, typeKey) {
  const data = rows(records);
  const stamp = new Date().toISOString().slice(0, 10);
  const headers = Object.keys(data[0] || { '成果类型': '', '市': '', '作业单位': '', '任务单元': '' });
  if (format === 'csv') {
    const quote = (value) => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const csv = '\uFEFF' + [headers.map(quote).join(','), ...data.map((row) => headers.map((key) => quote(row[key])).join(','))].join('\r\n');
    download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), '土壤普查收缴清单_' + typeKey + '_' + stamp + '.csv');
    return Promise.resolve();
  }
  if (typeof window.writeXlsxFile !== 'function') return Promise.reject(new Error('XLSX 导出组件未加载'));
  const sheet = [headers, ...data.map((row) => headers.map((key) => row[key] ?? ''))];
  const fileName = '土壤普查收缴清单_' + typeKey + '_' + stamp + '.xlsx';
  const writer = window.writeXlsxFile(sheet, {
    columns: headers.map((header) => ({ width: Math.max(12, Math.min(36, header.length * 2 + 6)) }))
  });
  if (!writer || typeof writer.toFile !== 'function') return Promise.reject(new Error('XLSX 导出组件版本不兼容'));
  return writer.toFile(fileName);
}
