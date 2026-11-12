import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLiveFeed } from './liveFeed.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const feed = createLiveFeed();
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

const server = createServer(async (request, response) => {
  try {
    if (await feed.handle(request, response)) return;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405).end();
      return;
    }
    let pathname = decodeURIComponent(new URL(request.url || '/', 'http://scalar.local').pathname);
    let file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(`${root}${path.sep}`) && file !== path.join(root, 'index.html')) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    try { if (!(await stat(file)).isFile()) file = path.join(root, 'index.html'); }
    catch { file = path.join(root, 'index.html'); }
    const contents = await readFile(file);
    response.writeHead(200, { 'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream', 'Cache-Control': path.extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600' });
    response.end(request.method === 'HEAD' ? undefined : contents);
  } catch {
    if (!response.headersSent) response.writeHead(500);
    response.end('Server error');
  }
});

const port = Number(process.env.PORT || 4174);
server.listen(port, '0.0.0.0', () => console.log(`Scalar LAN server listening on http://0.0.0.0:${port}`));
