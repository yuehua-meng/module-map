import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectStore } from '../packages/core/store.js';
import { scanCode } from '../packages/analyzer/index.js';
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'module-map-'));
  await fs.mkdir(path.join(root, 'src', 'orders'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'notify'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'src/orders/index.ts'),
    "import { notify } from '../notify/index.js';\nexport function order(){ notify(); }\n",
  );
  await fs.writeFile(path.join(root, 'src/notify/index.ts'), 'export function notify() {}\n');
  return {
    root,
    store: new ProjectStore(root),
    clean: () => fs.rm(root, { recursive: true, force: true }),
  };
}
test('extracts real source evidence, tsconfig aliases and ignores excluded files', async () => {
  const f = await fixture();
  try {
    await fs.writeFile(
      path.join(f.root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '@notify': ['src/notify/index.ts'] } },
      }),
    );
    await fs.writeFile(
      path.join(f.root, 'src/orders/alias.ts'),
      "export { notify } from '@notify';\nconst lazy = import('../notify/index.js');",
    );
    await fs.writeFile(path.join(f.root, '.gitignore'), 'ignored/\n');
    await fs.mkdir(path.join(f.root, 'ignored'));
    await fs.writeFile(path.join(f.root, 'ignored/oops.ts'), "import '../src/notify/index.js';");
    const g = await f.store.graph();
    assert.equal(g.files.length, 3);
    assert.equal(g.relations.length, 1);
    assert.equal(g.relations[0].evidence.length, 3);
    assert.equal(g.relations[0].evidence[0].line, 1);
    await assert.rejects(fs.access(path.join(f.root, '.project-map')));
    await assert.rejects(f.store.source('../outside.ts'));
  } finally {
    await f.clean();
  }
});
test('task rejects stale baseline and verifies only after removal plus reported checks', async () => {
  const f = await fixture();
  try {
    const g = await f.store.graph(),
      task = await f.store.createTask(g.relations[0].id, '取消通知', g.revision);
    await f.store.updateTask(task.id, 'claim');
    let result = await f.store.updateTask(task.id, 'report', {
      summary: '尚未修改',
      checks: [{ command: 'test', outcome: 'passed', detail: 'fixture' }],
    });
    assert.equal(result.status, 'needs-review');
    assert.equal(result.relationRemaining, true);
    await fs.writeFile(path.join(f.root, 'src/orders/index.ts'), 'export function order() {}\n');
    result = await f.store.updateTask(task.id, 'report', { summary: '移除依赖', checks: [] });
    assert.equal(result.status, 'needs-review');
    result = await f.store.updateTask(task.id, 'report', {
      summary: '移除依赖',
      checks: [{ command: 'test', outcome: 'passed', detail: 'fixture' }],
    });
    assert.equal(result.status, 'verified');
    assert.equal((await f.store.tasks())[0].status, 'verified');
    assert.equal((await f.store.graph()).relations.length, 0);
  } finally {
    await f.clean();
  }
});
test('rejects old revisions, duplicate tasks and invalid feature mappings', async () => {
  const f = await fixture();
  try {
    const g = await f.store.graph();
    await assert.rejects(
      f.store.saveFeatures(
        [{ id: 'x', name: 'bad', description: '', source: 'manual', files: ['outside.ts'] }],
        g.revision,
      ),
    );
    const task = await f.store.createTask(g.relations[0].id, '取消依赖', g.revision);
    await assert.rejects(f.store.createTask(g.relations[0].id, 'duplicate', g.revision));
    await fs.appendFile(path.join(f.root, 'src/orders/index.ts'), '// changed\n');
    await assert.rejects(f.store.updateTask(task.id, 'claim'), /过期/);
    await assert.rejects(f.store.saveFeatures(g.features, g.revision), /变化/);
    assert.equal((await f.store.updateTask(task.id, 'cancel')).status, 'cancelled');
  } finally {
    await f.clean();
  }
});
test('renaming or regrouping features cannot falsely verify dependency removal', async () => {
  const f = await fixture();
  try {
    const g = await f.store.graph(),
      task = await f.store.createTask(g.relations[0].id, '移除依赖', g.revision);
    await f.store.updateTask(task.id, 'claim');
    await f.store.saveFeatures(
      [
        {
          id: 'merged',
          name: '合并',
          description: '',
          source: 'manual',
          files: g.files.map((f) => f.path),
        },
      ],
      g.revision,
    );
    assert.equal((await f.store.graph()).relations.length, 0);
    const report = await f.store.updateTask(task.id, 'report', {
      summary: '只改分组',
      checks: [{ command: 'test', outcome: 'passed', detail: 'fixture' }],
    });
    assert.equal(report.status, 'needs-review');
    assert.equal(report.relationRemaining, true);
  } finally {
    await f.clean();
  }
});
test('new source files become unassigned and deleted files are diagnosed', async () => {
  const f = await fixture();
  try {
    const g = await f.store.graph();
    await f.store.saveFeatures(g.features, g.revision);
    await fs.writeFile(path.join(f.root, 'new.ts'), 'export const fresh = 1;');
    await fs.unlink(path.join(f.root, 'src/notify/index.ts'));
    const updated = await f.store.graph();
    assert.ok(updated.features.find((f) => f.id === '__unassigned')?.files.includes('new.ts'));
    assert.ok(updated.warnings.some((w) => w.includes('已不存在')));
    assert.notEqual(updated.revision, g.revision);
  } finally {
    await f.clean();
  }
});
test('scan detects computed dynamic imports as incomplete coverage', async () => {
  const f = await fixture();
  try {
    await fs.writeFile(path.join(f.root, 'dynamic.ts'), "const name = './runtime'; import(name);");
    const g = await scanCode(f.root);
    assert.ok(g.warnings.some((w) => w.includes('动态模块')));
  } finally {
    await f.clean();
  }
});
