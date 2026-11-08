// Minimal static dev server (no dependencies). Usage: node server.js [port]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';

const root = new URL('.', import.meta.url).pathname;
const port = +process.argv[2] || 8080;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.png': 'image/png' };

http.createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const path = normalize(join(root, url === '/' ? 'index.html' : url));
  if (!path.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(port, '0.0.0.0', () => {
  console.log(`Hexaverde running at http://localhost:${port}`);
  for (const ifs of Object.values(networkInterfaces())) for (const i of ifs || []) if (i.family === 'IPv4' && !i.internal) console.log(`  on your phone (same Wi-Fi): http://${i.address}:${port}`);
});
