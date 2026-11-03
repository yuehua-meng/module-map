import path from 'node:path';
const args = process.argv.slice(2),
  command = args[0] || 'serve';
const option = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1] || fallback;
};
const root = path.resolve(option('--project', process.cwd()));
try {
  if (command === 'mcp') {
    const { serveMcp } = await import('../mcp/index.js');
    await serveMcp(root);
  } else if (command === 'scan') {
    const { ProjectStore } = await import('../core/store.js');
    console.log(JSON.stringify(await new ProjectStore(root).graph(), null, 2));
  } else if (command === 'serve') {
    const port = Number(option('--port', '4317'));
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error('端口必须在 1024–65535 之间');
    const { startServer } = await import('../../apps/local-server/index.js');
    const server = await startServer(root, port);
    console.log('模块地图已启动：http://127.0.0.1:' + port + '\n项目：' + root);
    const close = () => server.close(() => process.exit(0));
    process.on('SIGINT', close);
    process.on('SIGTERM', close);
  } else throw new Error('支持的命令：serve、scan、mcp；参数：--project <目录>、--port <端口>');
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}
