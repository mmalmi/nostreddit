// Local compressed production serving for browser benchmarks; no development middleware.
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {gzipSync} from 'node:zlib';
const root=resolve(process.argv[2] || 'dist'), port=Number(process.argv[3] || 43183);
const cache=new Map();
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.wasm':'application/wasm','.webmanifest':'application/manifest+json','.png':'image/png'};
createServer(async(req,res)=>{
  try {
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    let file=resolve(root,'.'+path);
    if(file!==root && !file.startsWith(root+sep)) {res.writeHead(403).end();return;}
    if(!extname(file)||!(await stat(file).catch(()=>null))?.isFile()) file=resolve(root,'index.html');
    let body=cache.get(file);
    if(!body){body=gzipSync(await readFile(file));cache.set(file,body);}
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Content-Encoding':'gzip',
      'Cache-Control':file.includes(sep+'assets'+sep)?'public,max-age=31536000,immutable':'no-cache','Content-Length':body.length});
    res.end(body);
  } catch {res.writeHead(500).end();}
}).listen(port,'127.0.0.1',()=>console.log('Benchmark server ready'));
