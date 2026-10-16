import { createServer } from 'node:http';
import { createReadStream, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8080);
const legacyScript = readFileSync(resolve(root, 'hackathon.html'), 'utf8').replace(/\r\n?/g, '\n').match(/<script>([\s\S]*?)<\/script>/)?.[1];
const legacyHash = createHash('sha256').update(legacyScript || '').digest('base64');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    // Expose only the public application and the specific model runtime.
    const allowed = pathname === '/' || pathname === '/index.html' || pathname === '/hackathon.html'
      || /^\/tests\/model-smoke\.(html|js)$/.test(pathname)
      || /^\/src\/[\w.-]+\.(js|css)$/.test(pathname)
      || pathname === '/models/face_landmarker.task'
      || /^\/vendor\/(vision_bundle\.mjs|wasm\/[\w.-]+\.(js|wasm))$/.test(pathname);
    if (!allowed) { res.writeHead(404); res.end('Not found'); return; }
    const relative = pathname === '/' ? 'index.html' : pathname.startsWith('/vendor/')
      ? 'node_modules/@mediapipe/tasks-vision/' + pathname.slice('/vendor/'.length) : pathname.slice(1);
    const file = resolve(root, relative);
    if (!file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const info = await stat(file);
    if (!info.isFile()) throw new Error('Not a file');
    const csp = pathname === '/hackathon.html'
      ? `default-src 'self'; script-src 'self' 'sha256-${legacyHash}'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; object-src 'none'; frame-ancestors 'none'`
      : "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'";
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Content-Length': info.size, 'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff', 'Permissions-Policy': 'camera=(self), microphone=()',
      'Content-Security-Policy': csp });
    createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Không tìm thấy tài nguyên. Chạy npm install và npm run setup trước khi bật camera.');
  }
});
server.on('error', error => { console.error(error.code === 'EADDRINUSE'
  ? `Cổng ${port} đang được sử dụng. Đổi cổng: $env:PORT=8081; npm start` : error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Vin Driver Watch → http://127.0.0.1:${port}\nNhấn Ctrl+C để dừng. Camera chỉ bật khi bạn bấm nút trong ứng dụng.`));
