from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'src' / 'admin' / 'github.js'
data = path.read_bytes()
start_marker = b"  const remaining = await listReplyFiles(key);"
return_marker = b"  return { key, deleted: files.map((file) => file.name), verified: true };"
start = data.find(start_marker)
return_start = data.find(return_marker, start if start >= 0 else 0)
if start < 0 or return_start < 0:
    raise SystemExit('未找到删除后校验代码块的 ASCII 边界')
line_end = data.find(b'\n', return_start)
if line_end < 0:
    line_end = len(data)
else:
    line_end += 1
replacement = (
    "  const remaining = await listReplyFiles(key);\n"
    "  if (remaining.length) throw new Error('删除后校验失败，仍有 ' + remaining.length + ' 个答复文件');\n"
    "  return { key, deleted: files.map((file) => file.name), verified: true };\n"
).encode('utf-8')
path.write_bytes(data[:start] + replacement + data[line_end:])
print('Patched final admin deletion verification block by byte boundaries')
