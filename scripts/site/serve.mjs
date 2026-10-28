import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.mp4': 'video/mp4', '.vtt': 'text/vtt; charset=utf-8', '.json': 'application/json' };

export async function startSiteServer({ root = resolve('dist/site'), port = 0 } = {}) {
  root = resolve(root);
  const server = createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      if (!pathname.startsWith('/FlowAssert/')) { response.writeHead(404).end(); return; }
      const file = resolve(root, pathname.slice('/FlowAssert/'.length) || 'index.html');
      if (!file.startsWith(root + sep)) { response.writeHead(404).end(); return; }
      const info = await stat(file);
      if (!info.isFile()) { response.writeHead(404).end(); return; }
      let start = 0, end = info.size - 1, code = 200;
      const headers = { 'Content-Type': mime[extname(file)] ?? 'text/plain; charset=utf-8',
        'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' };
      if (request.headers.range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range);
        if (!match) { response.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end(); return; }
        start = Number(match[1]); end = match[2] ? Number(match[2]) : end;
        if (start > end || start >= info.size) { response.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end(); return; }
        end = Math.min(end, info.size - 1); code = 206;
        headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
      }
      headers['Content-Length'] = end - start + 1;
      response.writeHead(code, headers);
      if (request.method === 'HEAD') response.end();
      else createReadStream(file, { start, end }).on('error', () => response.destroy()).pipe(response);
    } catch { if (!response.headersSent) response.writeHead(404); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}/FlowAssert/` };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { server, url } = await startSiteServer({ port: 4173 });
  console.log(`Local: ${url}`);
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { server.close(); server.closeAllConnections(); });
}
