import path from 'node:path';
import crypto from 'node:crypto';
import { scanCode } from '../analyzer/index.js';
import type { Feature, Graph, Relation } from './types.js';
export const idFor = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
export function defaultFeatures(files: { path: string }[]): Feature[] {
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const parts = file.path.split('/');
    const group =
      parts.length === 1 ? '根目录' : parts.slice(0, Math.min(2, parts.length - 1)).join('/');
    groups.set(group, [...(groups.get(group) || []), file.path]);
  }
  return [...groups].map(([name, files]) => ({
    id: 'f-' + idFor(name),
    name,
    description: '按目录生成，可编辑为业务功能',
    files,
    source: 'directory',
  }));
}
export function validateFeatures(input: unknown, filePaths: string[]): Feature[] {
  if (!Array.isArray(input) || input.length > 1000) throw new Error('功能列表格式无效');
  const ids = new Set<string>(),
    known = new Set(filePaths);
  return input.map((f: any) => {
    if (!f || typeof f.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(f.id) || ids.has(f.id))
      throw new Error('功能 ID 无效或重复');
    ids.add(f.id);
    if (
      typeof f.name !== 'string' ||
      !f.name.trim() ||
      f.name.length > 100 ||
      typeof f.description !== 'string' ||
      f.description.length > 2000
    )
      throw new Error('功能名称或说明无效');
    if (
      !Array.isArray(f.files) ||
      f.files.some((p: unknown) => typeof p !== 'string' || !known.has(p as string))
    )
      throw new Error('功能包含未扫描到的文件');
    if (!['directory', 'manual', 'ai'].includes(f.source)) throw new Error('功能来源无效');
    return { ...f, name: f.name.trim(), files: [...new Set(f.files)] } as Feature;
  });
}
export async function buildGraph(root: string, saved?: Feature[]): Promise<Graph> {
  const code = await scanCode(root);
  const known = new Set(code.files.map((f) => f.path));
  let features = saved
    ? saved.map((f) => ({ ...f, files: f.files.filter((p) => known.has(p)) }))
    : defaultFeatures(code.files);
  const covered = new Set(features.flatMap((f) => f.files));
  const remaining = code.files.filter((f) => !covered.has(f.path));
  if (saved && remaining.length)
    features.push({
      id: '__unassigned',
      name: '待归类',
      description: '新增或未分组的源码',
      files: remaining.map((f) => f.path),
      source: 'directory',
    });
  const membership = new Map<string, string[]>();
  for (const f of features)
    for (const file of f.files) membership.set(file, [...(membership.get(file) || []), f.id]);
  const edges = new Map<string, Relation>();
  for (const e of code.imports)
    for (const a of membership.get(e.file) || [])
      for (const b of membership.get(e.target) || []) {
        if (a === b) continue;
        const id = a + '~' + b;
        if (!edges.has(id)) edges.set(id, { id, source: a, target: b, evidence: [] });
        edges.get(id)!.evidence.push(e);
      }
  const revision = idFor(code.revision + JSON.stringify(code.imports) + JSON.stringify(features));
  const missing = saved?.flatMap((f) => f.files.filter((p) => !known.has(p))) || [];
  return {
    ...code,
    revision,
    name: path.basename(code.root),
    scannedAt: new Date().toISOString(),
    features,
    relations: [...edges.values()],
    warnings: [...code.warnings, ...missing.map((p) => '映射中的文件已不存在：' + p)],
  };
}
