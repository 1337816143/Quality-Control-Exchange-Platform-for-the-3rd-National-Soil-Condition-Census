import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd(),dist=path.join(root,'dist');fs.rmSync(dist,{recursive:true,force:true});fs.mkdirSync(dist,{recursive:true});
const copy=(src,dst=src)=>{if(!fs.existsSync(src))return;fs.cpSync(src,path.join(dist,dst),{recursive:true});};
['index.html','upload-config.js','assets','data','src','reference-files','replies'].forEach((p)=>copy(p));
fs.mkdirSync(path.join(dist,'vendor'),{recursive:true});fs.copyFileSync('node_modules/write-excel-file/bundle/write-excel-file.min.js',path.join(dist,'vendor/write-excel-file.min.js'));
console.log('静态站点已输出到 dist/');
