/**
 * Dev server. Serves the project straight from source as ES modules — no
 * bundling — and reloads open pages when a file changes.
 *
 * It binds to every interface and prints the LAN address, because the only
 * test that matters is on a real phone (docs/TASKS.md, Phase 1).
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 5173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** Open reload streams. */
const clients = new Set();

/** Injected into index.html so a save reloads whatever is open, phone included. */
const RELOAD_SNIPPET = `
<script>
  (() => {
    const connect = () => {
      const source = new EventSource('/__reload');
      source.onmessage = () => location.reload();
      source.onerror = () => { source.close(); setTimeout(connect, 1000); };
    };
    connect();
  })();
</script>
`;

/** The first non-internal IPv4 address, which is what a phone can reach. */
function lanAddress() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return 'localhost';
}

/** Resolves a URL path to a file inside the project, or null if it escapes. */
function resolve(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0]));
  if (clean.includes('..')) return null;
  if (clean === '/' || clean === '/index.html') return join(ROOT, 'index.html');
  // public/ is served at the root so the manifest, icons, and sw.js sit at the
  // same paths they will have in dist/.
  if (
    clean.startsWith('/icons/') ||
    clean === '/manifest.webmanifest' ||
    clean === '/sw.js'
  ) {
    return join(ROOT, 'public', clean);
  }
  return join(ROOT, clean);
}

const server = createServer(async (req, res) => {
  if (req.url === '/__reload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  const file = resolve(req.url ?? '/');
  if (!file) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    let body = await readFile(file);
    const ext = extname(file);
    if (ext === '.html') {
      body = Buffer.from(String(body).replace('</body>', `${RELOAD_SNIPPET}</body>`));
    }
    res.writeHead(200, {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
});

let timer = null;
for (const dir of ['src', 'public']) {
  watch(join(ROOT, dir), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const client of clients) client.write('data: reload\n\n');
    }, 60);
  });
}
watch(join(ROOT, 'index.html'), () => {
  for (const client of clients) client.write('data: reload\n\n');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Underkeep dev server\n`);
  console.log(`  this computer:  http://localhost:${PORT}`);
  console.log(`  your phone:     http://${lanAddress()}:${PORT}\n`);
  console.log(`  (same Wi-Fi; add it to the home screen to test fullscreen)\n`);
});
