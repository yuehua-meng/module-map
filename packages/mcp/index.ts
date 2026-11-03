import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ProjectStore } from '../core/store.js';
export function createMcpServer(root: string) {
  const store = new ProjectStore(root);
  const server = new McpServer({ name: 'module-map', version: '0.1.0' });
  const result = async (fn: () => Promise<unknown>) => {
    try {
      return { content: [{ type: 'text' as const, text: JSON.stringify(await fn(), null, 2) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text' as const, text: (e as Error).message }] };
    }
  };
  server.registerTool(
    'get_project_graph',
    {
      description:
        '读取当前项目功能图、代码依赖证据与版本。功能来自目录或人工/AI归类，不代表运行时调用图。',
    },
    () => result(() => store.graph()),
  );
  server.registerTool(
    'get_feature',
    { description: '读取功能对应的源码和直接依赖。', inputSchema: { id: z.string() } },
    ({ id }) =>
      result(async () => {
        const g = await store.graph(),
          feature = g.features.find((f) => f.id === id);
        if (!feature) throw new Error('功能不存在');
        return {
          feature,
          revision: g.revision,
          relations: g.relations.filter((e) => e.source === id || e.target === id),
          files: g.files.filter((f) => feature.files.includes(f.path)),
        };
      }),
  );
  server.registerTool(
    'read_source',
    {
      description: '按地图中的文件路径读取附近代码。',
      inputSchema: { file: z.string(), line: z.number().int().positive().default(1) },
    },
    ({ file, line }) => result(() => store.source(file, line)),
  );
  server.registerTool(
    'save_features',
    {
      description: '保存业务功能映射。先读取最新地图，保留其他功能；AI归类标记 source=ai。',
      inputSchema: {
        revision: z.string(),
        features: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            description: z.string(),
            files: z.array(z.string()),
            source: z.enum(['directory', 'manual', 'ai']),
          }),
        ),
      },
    },
    ({ revision, features }) => result(() => store.saveFeatures(features, revision)),
  );
  server.registerTool(
    'list_change_tasks',
    { description: '列出画布上的修改任务。MCP 不会自动发起编程。' },
    () => result(() => store.tasks()),
  );
  server.registerTool(
    'create_change_task',
    {
      description: '对一条依赖创建修改意图，不会修改业务代码。',
      inputSchema: { relationId: z.string(), intent: z.string(), revision: z.string() },
    },
    ({ relationId, intent, revision }) =>
      result(() => store.createTask(relationId, intent, revision)),
  );
  server.registerTool(
    'claim_change_task',
    {
      description: '开始任务前必须领取；若代码基线过期则拒绝。领取后再修改代码并运行相关检查。',
      inputSchema: { id: z.string() },
    },
    ({ id }) => result(() => store.updateTask(id, 'claim')),
  );
  server.registerTool(
    'report_change_result',
    {
      description:
        '完成代码改动后回填真实检查结果。工具重新扫描依赖；仅静态关系消失且回填检查通过时标记结构已验证。不得虚构测试结果。',
      inputSchema: {
        id: z.string(),
        summary: z.string(),
        checks: z.array(
          z.object({
            command: z.string(),
            outcome: z.enum(['passed', 'failed', 'not-run']),
            detail: z.string(),
          }),
        ),
      },
    },
    ({ id, summary, checks }) => result(() => store.updateTask(id, 'report', { summary, checks })),
  );
  server.registerTool(
    'cancel_change_task',
    { description: '取消未结束的修改任务；不回滚代码。', inputSchema: { id: z.string() } },
    ({ id }) => result(() => store.updateTask(id, 'cancel')),
  );
  return server;
}
export async function serveMcp(root: string) {
  await createMcpServer(root).connect(new StdioServerTransport());
}
