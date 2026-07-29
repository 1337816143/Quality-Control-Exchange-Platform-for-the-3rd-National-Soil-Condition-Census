import fs from 'node:fs';
import { PNG } from 'pngjs';
const png = PNG.sync.read(fs.readFileSync('assets/soil-survey-logo.png'));
if (png.width !== 549 || png.height !== 549) throw new Error('Logo 必须为 549×549');
const alpha = (x,y) => png.data[(png.width*y+x)*4+3];
for (const [x,y] of [[0,0],[548,0],[0,548],[548,548]]) if (alpha(x,y) !== 0) throw new Error('Logo 角像素必须透明');
let opaque = 0; for (let i=3;i<png.data.length;i+=4) if (png.data[i] > 0) opaque += 1;
if (opaque < png.width * png.height * .1) throw new Error('Logo 有效图形面积异常');
console.log('Logo 校验通过：549×549 RGBA，透明角像素正常。');
