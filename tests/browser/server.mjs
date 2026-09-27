// Minimal static server for the browser smoke test: serves the repo root (lib/ and tests/browser/).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.map': 'application/json',
};
const port = Number(process.env.PORT ?? 4173);

createServer(async (req, res) => {
  const path = normalize(
    decodeURIComponent(new URL(req.url, 'http://x').pathname),
  ).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, {
      'content-type': types[extname(path)] ?? 'application/octet-stream',
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(port, () =>
  console.log(`serving ${root} on http://localhost:${port}`),
);
