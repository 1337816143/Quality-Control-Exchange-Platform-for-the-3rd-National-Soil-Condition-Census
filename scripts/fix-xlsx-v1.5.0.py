from pathlib import Path

exporter = Path('src/export/index.js')
text = exporter.read_text(encoding='utf-8')
old = """  if (typeof window.writeXlsxFile !== 'function') return Promise.reject(new Error('XLSX 导出组件未加载'));
  const sheet = [headers, ...data.map((row) => headers.map((key) => row[key] ?? ''))];
  return window.writeXlsxFile(sheet, {
    fileName: '土壤普查收缴清单_' + typeKey + '_' + stamp + '.xlsx',
    columns: headers.map((header) => ({ width: Math.max(12, Math.min(36, header.length * 2 + 6)) }))
  });
"""
new = """  if (typeof window.writeXlsxFile !== 'function') return Promise.reject(new Error('XLSX 导出组件未加载'));
  const sheet = [headers, ...data.map((row) => headers.map((key) => row[key] ?? ''))];
  const fileName = '土壤普查收缴清单_' + typeKey + '_' + stamp + '.xlsx';
  const writer = window.writeXlsxFile(sheet, {
    columns: headers.map((header) => ({ width: Math.max(12, Math.min(36, header.length * 2 + 6)) }))
  });
  if (!writer || typeof writer.toFile !== 'function') return Promise.reject(new Error('XLSX 导出组件版本不兼容'));
  return writer.toFile(fileName);
"""
if old not in text:
    raise SystemExit('未找到旧版 XLSX 导出调用')
exporter.write_text(text.replace(old, new), encoding='utf-8')
print('Updated XLSX export to write-excel-file v4 toFile API.')
