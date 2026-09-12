import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractHackerNewsTop5 } from './webcmd-runner.mjs';
import { runSelfHealingWorkflow } from './self-healing-runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // SSE Stream Endpoint: /api/run-hn-stream
  if (url.pathname === '/api/run-hn-stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const sendEvent = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent('status', { message: 'Connection established. Preparing task...', step: 'init' });

    try {
      const result = await extractHackerNewsTop5((statusUpdate) => {
        sendEvent('status', statusUpdate);
      });
      sendEvent('result', result);
      sendEvent('done', { ok: true, durationMs: Date.now() });
    } catch (err) {
      sendEvent('error', {
        message: err.message || 'Automation failed',
        code: err.code || 'RUN_ERROR',
      });
    } finally {
      res.end();
    }
    return;
  }

  // SSE Stream Endpoint: /api/run-self-healing-stream
  if (url.pathname === '/api/run-self-healing-stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const sendEvent = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent('status', { message: 'Connecting to Self-Healing Automation Engine...', step: 'init', phase: 1 });

    try {
      const result = await runSelfHealingWorkflow((statusUpdate) => {
        sendEvent('status', statusUpdate);
      });
      sendEvent('result', result);
      sendEvent('done', { ok: true, durationMs: Date.now() });
    } catch (err) {
      sendEvent('error', {
        message: err.message || 'Self-healing workflow failed',
        code: err.code || 'HEAL_ERROR',
      });
    } finally {
      res.end();
    }
    return;
  }

  // REST API Endpoint: /api/run-hn
  if (url.pathname === '/api/run-hn' && (req.method === 'POST' || req.method === 'GET')) {
    try {
      const events = [];
      const result = await extractHackerNewsTop5((event) => events.push(event));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, events, result }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  // Health check: /api/health
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', engine: 'webcmd', time: new Date().toISOString() }));
    return;
  }

  // Static File Serving (including /portal -> portal.html)
  let targetFile = url.pathname;
  if (targetFile === '/' || targetFile === '') {
    targetFile = 'index.html';
  } else if (targetFile === '/portal' || targetFile === '/portal/') {
    targetFile = 'portal.html';
  }

  let filePath = path.join(PUBLIC_DIR, targetFile);
  
  // Security check: prevent directory traversal outside public
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n======================================================`);
  console.log(`  Daily Work Navigator (Webcmd Hackathon App)`);
  console.log(`  Running on: http://127.0.0.1:${PORT}`);
  console.log(`  Engine: Webcmd CLI & Daemon (Cloak Chromium)`);
  console.log(`======================================================\n`);
});
