from pathlib import Path
from base64 import b64decode
from io import BytesIO
import re
from collections import deque
from PIL import Image

root = Path(__file__).resolve().parents[1]
svg_path = root / "assets" / "soil-survey-logo.svg"
svg = svg_path.read_text(encoding="utf-8")
match = re.search(r'data:image/(?:jpeg|jpg);base64,([^"\s]+)', svg)
if not match:
    raise SystemExit("未找到 SVG 内嵌 JPEG")

image = Image.open(BytesIO(b64decode(match.group(1)))).convert("RGBA")
image = image.resize((549, 549), Image.Resampling.LANCZOS)
pixels = image.load()
width, height = image.size
seen = set()
queue = deque()
for x in range(width):
    queue.append((x, 0))
    queue.append((x, height - 1))
for y in range(height):
    queue.append((0, y))
    queue.append((width - 1, y))

while queue:
    x, y = queue.popleft()
    if (x, y) in seen:
        continue
    seen.add((x, y))
    r, g, b, _ = pixels[x, y]
    if min(r, g, b) < 238 or max(r, g, b) - min(r, g, b) > 14:
        continue
    pixels[x, y] = (r, g, b, 0)
    if x:
        queue.append((x - 1, y))
    if x + 1 < width:
        queue.append((x + 1, y))
    if y:
        queue.append((x, y - 1))
    if y + 1 < height:
        queue.append((x, y + 1))

output = root / "assets" / "soil-survey-logo.png"
image.save(output, "PNG", optimize=True)
print(output)
