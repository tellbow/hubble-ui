// Serves the production build (server/public) and proxies /api to the
// backend, as nginx does in a deployment. Only for the Playwright tests.
import { createReadStream, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../server/public');
const port = Number(process.env.PORT ?? 12000);
const backend = { host: '127.0.0.1', port: Number(process.env.BACKEND_PORT ?? 8090) };
const types = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.html': 'text/html',
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) {
      const proxied = http.request(
        { ...backend, path: req.url, method: req.method, headers: req.headers },
        r => {
          res.writeHead(r.statusCode, r.headers);
          r.pipe(res);
        },
      );
      proxied.on('error', () => res.writeHead(502).end());
      return void req.pipe(proxied);
    }

    // Like nginx's try_files: a file if there is one, else index.html.
    let file = path.join(root, path.normalize(url.pathname));
    if (!file.startsWith(root) || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
      file = path.join(root, 'index.html');
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  })
  .listen(port, '127.0.0.1');
