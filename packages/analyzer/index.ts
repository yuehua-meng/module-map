import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
import ignore from 'ignore';
import type { CodeFile, Evidence } from '../core/types.js';

const excluded = new Set([
  'node_modules',
  '.git',
  '.project-map',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  'vendor',
  '.venv',
]);
const sourcePattern = /\.(?:[cm]?[jt]sx?)$/i;
type CachedFile = {
  key: string;
  file: CodeFile;
  imports: Evidence[];
  warnings: string[];
  external: number;
};
const projectCaches = new Map<string, Map<string, CachedFile>>();
const slash = (s: string) => s.split(path.sep).join('/');
export async function canonicalRoot(input: string) {
  const root = await fs.realpath(path.resolve(input));
  if (!(await fs.stat(root)).isDirectory()) throw new Error('请选择项目目录');
  return root;
}
export function inside(root: string, file: string) {
  const rel = path.relative(root, file);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
export async function scanCode(input: string) {
  const root = await canonicalRoot(input);
  if (!projectCaches.has(root)) {
    if (projectCaches.size >= 5) projectCaches.delete(projectCaches.keys().next().value!);
    projectCaches.set(root, new Map());
  }
  const cache = projectCaches.get(root)!;
  const warnings: string[] = [];
  const paths: string[] = [];
  const configs: string[] = [];
  const hash = crypto.createHash('sha256');
  const rootIgnore = ignore();
  async function walk(dir: string, rules: { base: string; matcher: ReturnType<typeof ignore> }[]) {
    let local = '';
    try {
      local = await fs.readFile(path.join(dir, '.gitignore'), 'utf8');
    } catch {}
    if (local) {
      hash.update(slash(path.relative(root, dir)) + local);
      rules = [...rules, { base: dir, matcher: ignore().add(local) }];
    }
    const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const e of entries) {
      if (excluded.has(e.name) || e.isSymbolicLink()) continue;
      const absolute = path.join(dir, e.name);
      if (
        rules.some((r) =>
          r.matcher.ignores(slash(path.relative(r.base, absolute)) + (e.isDirectory() ? '/' : '')),
        )
      )
        continue;
      if (e.isDirectory()) {
        await walk(absolute, rules);
        continue;
      }
      if (/^(?:tsconfig|jsconfig)(?:\..+)?\.json$/.test(e.name) || e.name === 'package.json')
        configs.push(absolute);
      if (sourcePattern.test(e.name) && !/\.d\.[cm]?ts$/.test(e.name)) paths.push(absolute);
      if (paths.length > 20000)
        throw new Error('项目超过 20,000 个源码文件，请通过 .gitignore 缩小范围');
    }
  }
  await walk(root, [{ base: root, matcher: rootIgnore }]);
  for (const p of configs.sort())
    hash.update(slash(path.relative(root, p))).update(await fs.readFile(p));
  const known = new Set(paths.map((p) => path.resolve(p)));
  for (const key of cache.keys()) if (!known.has(key)) cache.delete(key);
  const resolutionKey = crypto
    .createHash('sha256')
    .update(paths.join('\n'))
    .update(hash.copy().digest('hex'))
    .digest('hex');
  const configCache = new Map<string, ts.CompilerOptions>();
  function optionsFor(file: string) {
    let dir = path.dirname(file);
    while (inside(root, dir)) {
      const config = configs.find(
        (c) => path.dirname(c) === dir && /[\\/](tsconfig|jsconfig)\.json$/.test(c),
      );
      if (config) {
        if (!configCache.has(config)) {
          const read = ts.readConfigFile(config, ts.sys.readFile);
          const parsed = ts.parseJsonConfigFileContent(read.config || {}, ts.sys, dir);
          configCache.set(config, { ...parsed.options, allowJs: true });
          if (read.error) warnings.push('无法完整读取配置：' + slash(path.relative(root, config)));
        }
        return configCache.get(config)!;
      }
      if (dir === root) break;
      dir = path.dirname(dir);
    }
    return {
      allowJs: true,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      module: ts.ModuleKind.ESNext,
    };
  }
  const files: CodeFile[] = [],
    imports: Evidence[] = [];
  let externalImports = 0;
  for (const absolute of paths) {
    const rel = slash(path.relative(root, absolute));
    const stat = await fs.stat(absolute);
    if (stat.size > 2_000_000) {
      warnings.push('文件过大，未分析：' + rel);
      hash.update(rel + ':oversize:' + stat.mtimeMs);
      continue;
    }
    const text = await fs.readFile(absolute, 'utf8');
    hash.update(rel).update('\0').update(text).update('\0');
    const options = optionsFor(absolute);
    const cacheKey = crypto
      .createHash('sha256')
      .update(text)
      .update(resolutionKey)
      .update(JSON.stringify(options))
      .digest('hex');
    const previous = cache.get(absolute);
    if (previous?.key === cacheKey) {
      files.push(previous.file);
      imports.push(...previous.imports);
      warnings.push(...previous.warnings);
      externalImports += previous.external;
      continue;
    }
    const importsStart = imports.length,
      warningsStart = warnings.length,
      externalStart = externalImports;
    const ast = ts.createSourceFile(absolute, text, ts.ScriptTarget.Latest, true);
    const symbols: string[] = [];
    function record(node: ts.Node, specifier: string, kind: Evidence['kind']) {
      let resolved = ts.resolveModuleName(specifier, absolute, options, ts.sys).resolvedModule
        ?.resolvedFileName;
      if (!resolved && specifier.startsWith('.')) {
        const base = path.resolve(path.dirname(absolute), specifier).replace(/\.[cm]?js$/, '');
        resolved = [
          base,
          ...[
            '.ts',
            '.tsx',
            '.js',
            '.jsx',
            '.mts',
            '.cts',
            '/index.ts',
            '/index.tsx',
            '/index.js',
          ].map((ext) => base + ext),
        ].find((p) => known.has(path.resolve(p)));
      }
      if (resolved && known.has(path.resolve(resolved))) {
        imports.push({
          file: rel,
          target: slash(path.relative(root, resolved)),
          specifier,
          kind,
          line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
        });
      } else if (
        specifier.startsWith('.') ||
        (resolved && inside(root, resolved) && !resolved.includes('node_modules'))
      ) {
        warnings.push(
          rel +
            ':' +
            (ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1) +
            ' 未纳入图：' +
            specifier,
        );
      } else externalImports++;
    }
    function visit(node: ts.Node) {
      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node)) &&
        node.name
      )
        symbols.push(node.name.text);
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier))
        record(node, node.moduleSpecifier.text, node.importClause?.isTypeOnly ? 'type' : 'import');
      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        record(node, node.moduleSpecifier.text, node.isTypeOnly ? 'type' : 'export');
      if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteral(node.moduleReference.expression)
      )
        record(node, node.moduleReference.expression.text, 'require');
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      ) {
        if (node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]))
          record(
            node,
            node.arguments[0].text,
            node.expression.kind === ts.SyntaxKind.ImportKeyword ? 'dynamic' : 'require',
          );
        else warnings.push(rel + ' 存在无法静态解析的动态模块引用');
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    const file = { path: rel, symbols: [...new Set(symbols)], lines: text.split('\n').length };
    files.push(file);
    cache.set(absolute, {
      key: cacheKey,
      file,
      imports: imports.slice(importsStart),
      warnings: warnings.slice(warningsStart),
      external: externalImports - externalStart,
    });
  }
  return {
    root,
    files,
    imports,
    externalImports,
    warnings: [...new Set(warnings)],
    revision: hash.digest('hex'),
  };
}
