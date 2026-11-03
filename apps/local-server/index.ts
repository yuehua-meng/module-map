import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ProjectStore } from '../../packages/core/store.js';
import { canonicalRoot, inside } from '../../packages/analyzer/index.js';
const webRoot = fileURLToPath(new URL('../../dist/web/', import.meta.url));
const token = crypto.randomBytes(24).toString('hex');
const json = (res: http.ServerResponse, value: unknown, status = 200) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(value));
};
async function body(req: http.IncomingMessage) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 2_000_000) throw new Error('请求过大');
  }
  return raw ? JSON.parse(raw) : {};
}
export async function startServer(root: string, port = 4317) {
  let store = new ProjectStore(await canonicalRoot(root));
  let lastGraph = await store.graph(),
    error = '',
    scanning = false;
  async function refresh() {
    if (scanning) return;
    scanning = true;
    const current = store;
    try {
      const graph = await current.graph();
      if (current === store) {
        lastGraph = graph;
        error = '';
      }
    } catch (e) {
      if (current === store) error = (e as Error).message;
    } finally {
      scanning = false;
    }
  }
  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || '';
      if (!['127.0.0.1:' + port, 'localhost:' + port].includes(host)) {
        json(res, { error: '无效主机' }, 403);
        return;
      }
      const origin = req.headers.origin;
      if (origin && !['http://127.0.0.1:' + port, 'http://localhost:' + port].includes(origin)) {
        json(res, { error: '拒绝跨站请求' }, 403);
        return;
      }
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
      );
      const url = new URL(req.url || '/', 'http://' + host),
        route = url.pathname;
      if (route.startsWith('/api/')) {
        if (req.headers['x-project-map-token'] !== token) {
          json(res, { error: '请从本地首页重新打开' }, 403);
          return;
        }
        const current = store;
        if (req.method === 'GET' && route === '/api/state') {
          json(res, { graph: lastGraph, tasks: await current.tasks(), error, scanning });
          return;
        }
        if (req.method === 'GET' && route === '/api/source') {
          json(
            res,
            await current.source(
              url.searchParams.get('file') || '',
              Number(url.searchParams.get('line') || 1),
            ),
          );
          return;
        }
        if (req.method === 'GET' && route === '/api/integration') {
          const cli = fileURLToPath(new URL('../../packages/cli/index.ts', import.meta.url));
          const tsx = fileURLToPath(
            new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url),
          );
          json(res, {
            command: process.execPath,
            args: [tsx, cli, 'mcp', '--project', current.root],
          });
          return;
        }
        if (req.method !== 'POST') {
          json(res, { error: '接口不存在' }, 404);
          return;
        }
        const data = await body(req);
        if (route === '/api/open') {
          if (typeof data.path !== 'string') throw new Error('请输入项目路径');
          const next = new ProjectStore(await canonicalRoot(data.path)),
            graph = await next.graph();
          store = next;
          lastGraph = graph;
          error = '';
          json(res, { ok: true });
          return;
        }
        if (route === '/api/scan') {
          await refresh();
          if (error) throw new Error(error);
          json(res, { ok: true });
          return;
        }
        if (route === '/api/features') {
          lastGraph = await current.saveFeatures(data.features, data.revision);
          json(res, { ok: true });
          return;
        }
        if (route === '/api/tasks') {
          json(res, await current.createTask(data.relationId, data.intent, data.revision));
          return;
        }
        if (route === '/api/tasks/cancel') {
          json(res, await current.updateTask(data.id, 'cancel'));
          return;
        }
        json(res, { error: '接口不存在' }, 404);
        return;
      }
      if (req.method !== 'GET') {
        res.writeHead(405);
        res.end();
        return;
      }
      const file = path.resolve(
        webRoot,
        '.' + decodeURIComponent(route === '/' ? '/index.html' : route),
      );
      if (!inside(webRoot, file)) {
        res.writeHead(403);
        res.end();
        return;
      }
      try {
        const contents = await fs.readFile(file);
        const ext = path.extname(file);
        const mime: Record<string, string> = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
        };
        res.writeHead(200, {
          'Content-Type': mime[ext] || 'application/octet-stream',
          'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
        });
        res.end(ext === '.html' ? contents.toString().replace('__APP_TOKEN__', token) : contents);
      } catch {
        res.writeHead(404);
        res.end('请先运行 npm run build');
      }
    } catch (e) {
      json(res, { error: (e as Error).message }, 400);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  // Polling also catches Git branch switches and writes made by separate MCP processes.
  const timer = setInterval(() => void refresh(), 3000);
  timer.unref();
  server.on('close', () => clearInterval(timer));
  return server;
}
