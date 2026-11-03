import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startServer } from '../apps/local-server/index.js';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'map-integration-'));
  await fs.mkdir(path.join(root, 'a'));
  await fs.mkdir(path.join(root, 'b'));
  await fs.writeFile(path.join(root, 'a/index.ts'), "import '../b/index.js';");
  await fs.writeFile(path.join(root, 'b/index.ts'), 'export const b = 1;');
  return root;
}
test('real MCP stdio exposes map and completes task lifecycle', async () => {
  const root = await fixture();
  const client = new Client({ name: 'module-map-test', version: '1.0.0' });
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.join(repo, 'node_modules/tsx/dist/cli.mjs'),
      path.join(repo, 'packages/cli/index.ts'),
      'mcp',
      '--project',
      root,
    ],
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 9);
    async function call(name: string, args: Record<string, unknown> = {}) {
      const result = await client.callTool({ name, arguments: args });
      assert.ok(!result.isError, JSON.stringify(result));
      return JSON.parse((result.content as { text: string }[])[0].text);
    }
    const graph = await call('get_project_graph');
    assert.equal(graph.relations.length, 1);
    const task = await call('create_change_task', {
      relationId: graph.relations[0].id,
      intent: 'Remove dependency',
      revision: graph.revision,
    });
    await call('claim_change_task', { id: task.id });
    await fs.writeFile(path.join(root, 'a/index.ts'), 'export const a = 1;');
    const result = await call('report_change_result', {
      id: task.id,
      summary: 'Removed import in fixture',
      checks: [
        {
          command: 'fixture assertion',
          outcome: 'passed',
          detail: 'Fixture source updated by integration test',
        },
      ],
    });
    assert.equal(result.status, 'verified');
  } finally {
    await client.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('HTTP rejects cross-site access, serves state and detects source changes', async () => {
  const root = await fixture(),
    port = 14317,
    base = 'http://127.0.0.1:' + port;
  const server = await startServer(root, port);
  try {
    assert.equal((await fetch(base + '/api/state')).status, 403);
    const html = await (await fetch(base)).text(),
      token = html.match(/name="app-token" content="([^"]+)"/)?.[1];
    assert.ok(token);
    const headers = { 'X-Project-Map-Token': token! };
    const initial = await (await fetch(base + '/api/state', { headers })).json();
    assert.equal(initial.graph.files.length, 2);
    assert.equal(
      (
        await fetch(base + '/api/state', {
          headers: { ...headers, Origin: 'https://untrusted.example' },
        })
      ).status,
      403,
    );
    assert.equal((await fetch(base + '/api/source?file=..%2Fsecret.txt', { headers })).status, 400);
    await fs.writeFile(path.join(root, 'a/index.ts'), 'export const a = 1;');
    await new Promise((resolve) => setTimeout(resolve, 3400));
    const changed = await (await fetch(base + '/api/state', { headers })).json();
    assert.notEqual(changed.graph.revision, initial.graph.revision);
    assert.equal(changed.graph.relations.length, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(root, { recursive: true, force: true });
  }
});
