// Run: node playground/browser-test-server.js, then open http://127.0.0.1:4180/
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const pages = new Map([
  ['/', 'browser-popup-test.html'],
  ['/browser-popup-test.html', 'browser-popup-test.html'],
  ['/browser-popup-target.html', 'browser-popup-target.html'],
]);
createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/popup-post' && request.method === 'POST') {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 4096) { response.writeHead(413).end(); return; }
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'" });
    response.end(`<!doctype html><title>POST result</title><p>Received POST value: ${new URLSearchParams(body).get('test') === 'post-value' ? 'post-value' : '(unexpected)'}</p>`);
    return;
  }
  const file = pages.get(path);
  if (!file || request.method !== 'GET') { response.writeHead(404).end(); return; }
  try {
    const body = await readFile(new URL(file, import.meta.url));
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(body);
  } catch { response.writeHead(500).end(); }
}).listen(4180, '127.0.0.1', () => console.log('Browser test: http://127.0.0.1:4180/'));
