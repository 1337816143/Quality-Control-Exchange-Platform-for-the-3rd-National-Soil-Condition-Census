from pathlib import Path
import re

path = Path(__file__).resolve().parents[1] / 'src' / 'admin' / 'github.js'
text = path.read_text(encoding='utf-8', errors='replace')
pattern = re.compile(
    r"  const remaining = await listReplyFiles\(key\);[\s\S]*?  return \{ key, deleted: files\.map\(\(file\) => file\.name\), verified: true \};"
)
replacement = """  const remaining = await listReplyFiles(key);
  if (remaining.length) throw new Error('删除后校验失败，仍有 ' + remaining.length + ' 个答复文件');
  return { key, deleted: files.map((file) => file.name), verified: true };"""
updated, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit('未找到删除后校验代码块，无法修复')
path.write_text(updated, encoding='utf-8')
print('Normalized final admin deletion verification syntax as UTF-8')
