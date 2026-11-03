import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { canonicalRoot, inside } from '../analyzer/index.js';
import { buildGraph, validateFeatures } from './graph.js';
import type { Feature, Graph, ChangeTask, CheckResult } from './types.js';

export class ProjectStore {
  constructor(public root: string) {}
  async location(runtime = false, create = false) {
    this.root = await canonicalRoot(this.root);
    let dir = path.join(this.root, '.project-map');
    for (const part of runtime ? ['.project-map', 'runtime'] : ['.project-map']) {
      dir = part === '.project-map' ? path.join(this.root, part) : path.join(dir, part);
      try {
        const info = await fs.lstat(dir);
        if (
          info.isSymbolicLink() ||
          !info.isDirectory() ||
          !inside(this.root, await fs.realpath(dir))
        )
          throw new Error('地图存储目录不安全');
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw e;
        if (create) await fs.mkdir(dir);
      }
    }
    return dir;
  }
  async read<T>(name: string, fallback: T, runtime = false): Promise<T> {
    const file = path.join(await this.location(runtime), name);
    try {
      if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('不读取符号链接元数据');
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (e: any) {
      if (e.code === 'ENOENT') return fallback;
      throw e;
    }
  }
  async write(name: string, value: unknown, runtime = false) {
    const dir = await this.location(runtime, true);
    const target = path.join(dir, name),
      temp = target + '.' + crypto.randomUUID() + '.tmp';
    await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
    try {
      await fs.rename(temp, target);
    } finally {
      await fs.rm(temp, { force: true });
    }
  }
  async lock<T>(fn: () => Promise<T>): Promise<T> {
    const dir = await this.location(false, true);
    const lockFile = path.join(dir, 'write.lock');
    let handle;
    try {
      handle = await fs.open(lockFile, 'wx');
    } catch (e: any) {
      if (e.code === 'EEXIST') throw new Error('另一个操作正在保存，请稍后重试');
      throw e;
    }
    try {
      await handle.writeFile(String(process.pid));
      const ignoreFile = path.join(dir, '.gitignore');
      try {
        await fs.writeFile(ignoreFile, 'runtime/\n*.lock\n*.tmp\n', { flag: 'wx' });
      } catch (e: any) {
        if (e.code !== 'EEXIST') throw e;
      }
      return await fn();
    } finally {
      await handle.close();
      await fs.unlink(lockFile);
    }
  }
  async graph(): Promise<Graph> {
    const saved = await this.read<Feature[] | undefined>('features.json', undefined);
    return buildGraph(this.root, saved);
  }
  async tasks() {
    return this.read<ChangeTask[]>('tasks.json', [], true);
  }
  async saveFeatures(features: unknown, revision: string) {
    return this.lock(async () => {
      const graph = await this.graph();
      if (graph.revision !== revision) throw new Error('地图已变化，请刷新后保存');
      const validated = validateFeatures(
        features,
        graph.files.map((f) => f.path),
      );
      await this.write(
        'features.json',
        validated.filter((f) => f.id !== '__unassigned'),
      );
      return this.graph();
    });
  }
  async createTask(relationId: string, intent: string, revision: string) {
    return this.lock(async () => {
      const graph = await this.graph();
      if (graph.revision !== revision) throw new Error('代码或地图已变化，请刷新影响预览');
      const edge = graph.relations.find((e) => e.id === relationId);
      if (!edge) throw new Error('关系不存在');
      if (!intent.trim() || intent.length > 4000) throw new Error('请填写不超过 4000 字的修改意图');
      const tasks = await this.tasks();
      if (
        tasks.some(
          (t) =>
            t.source === edge.source &&
            t.target === edge.target &&
            ['pending', 'in-progress'].includes(t.status),
        )
      )
        throw new Error('此关系已有待处理任务');
      const name = (id: string) => graph.features.find((f) => f.id === id)?.name || id;
      const now = new Date().toISOString();
      const task: ChangeTask = {
        id: crypto.randomUUID(),
        title: name(edge.source) + ' → ' + name(edge.target),
        intent: intent.trim(),
        source: edge.source,
        target: edge.target,
        baseRevision: graph.revision,
        createdAt: now,
        updatedAt: now,
        status: 'pending',
        evidence: edge.evidence,
        checks: [],
        summary: '',
      };
      tasks.unshift(task);
      await this.write('tasks.json', tasks, true);
      return task;
    });
  }
  async updateTask(
    id: string,
    action: 'claim' | 'cancel' | 'report',
    report?: { summary: string; checks: CheckResult[] },
  ) {
    return this.lock(async () => {
      const tasks = await this.tasks(),
        task = tasks.find((t) => t.id === id);
      if (!task) throw new Error('任务不存在');
      if (action === 'cancel') {
        if (['verified', 'cancelled'].includes(task.status)) throw new Error('任务已经结束');
        task.status = 'cancelled';
      } else if (action === 'claim') {
        if (task.status !== 'pending') throw new Error('只能领取待实施任务');
        const graph = await this.graph();
        if (graph.revision !== task.baseRevision)
          throw new Error('任务基线已过期，请取消任务并基于最新地图重新创建');
        task.status = 'in-progress';
      } else {
        if (!['in-progress', 'needs-review'].includes(task.status))
          throw new Error('先领取任务，再回填结果');
        if (
          !report ||
          typeof report.summary !== 'string' ||
          !report.summary.trim() ||
          report.summary.length > 8000 ||
          !Array.isArray(report.checks) ||
          report.checks.length > 30
        )
          throw new Error('结果格式无效');
        for (const c of report.checks)
          if (
            typeof c.command !== 'string' ||
            typeof c.detail !== 'string' ||
            !['passed', 'failed', 'not-run'].includes(c.outcome) ||
            c.command.length > 2000 ||
            c.detail.length > 8000
          )
            throw new Error('检查记录格式无效');
        const graph = await this.graph();
        const remains =
          graph.imports.some((e) =>
            task.evidence.some((old) => old.file === e.file && old.target === e.target),
          ) || graph.relations.some((e) => e.source === task.source && e.target === task.target);
        task.observedRevision = graph.revision;
        task.relationRemaining = remains;
        task.summary = report.summary;
        task.checks = report.checks;
        const checksPass =
          report.checks.length > 0 && report.checks.every((c) => c.outcome === 'passed');
        task.status = !remains && checksPass ? 'verified' : 'needs-review';
        task.verification = remains
          ? '静态依赖仍存在'
          : checksPass
            ? '静态依赖已消失；检查结果由执行方回填，工具未独立执行'
            : '静态依赖已消失，仍缺少通过的检查记录';
      }
      task.updatedAt = new Date().toISOString();
      await this.write('tasks.json', tasks, true);
      return task;
    });
  }
  async source(file: string, line = 1) {
    const graph = await this.graph();
    if (!graph.files.some((f) => f.path === file)) throw new Error('文件不在当前源码索引中');
    const absolute = await fs.realpath(path.resolve(this.root, file));
    if (!inside(this.root, absolute)) throw new Error('文件超出项目目录');
    const lines = (await fs.readFile(absolute, 'utf8')).split('\n');
    const start = Math.max(1, Math.min(lines.length, Math.floor(line)) - 6),
      end = Math.min(lines.length, start + 34);
    return { file, start, lines: lines.slice(start - 1, end), total: lines.length };
  }
}
