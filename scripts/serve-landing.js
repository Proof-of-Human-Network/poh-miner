#!/usr/bin/env node
/**
 * Serve the PoH Miner landing page + allow direct downloads of installers.
 * Run with: npm run serve:landing
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 4321;
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(__dirname, '..'); // project root

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.sh': 'text/plain',
  '.ps1': 'text/plain',
  '.json': 'application/json',
  '.apk': 'application/vnd.android.package-archive',
};

const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/landing/index.html';

  const filePath = path.join(ROOT, urlPath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';

    // Force download for installer files and the Android wallet APK
    const isDownloadable = ext === '.sh' || ext === '.ps1' || ext === '.apk';
    const headers = {
      'Content-Type': contentType,
    };

    if (isDownloadable) {
      headers['Content-Disposition'] = `attachment; filename="${path.basename(filePath)}"`;
    }

    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n🌍 PoH Miner Landing + Direct Downloads`);
  console.log(`   → http://localhost:${PORT}\n`);
  console.log(`   Installation files + Android wallet APK are served directly when you click the download buttons.\n`);
});
