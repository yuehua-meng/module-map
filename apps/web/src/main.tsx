import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Graph, Feature, ChangeTask } from '../../../packages/core/types';
import { GraphView } from './GraphView';
import './style.css';

const token = document.querySelector<HTMLMetaElement>('meta[name="app-token"]')?.content || '';
async function api<T = any>(route: string, data?: unknown): Promise<T> {
  const response = await fetch('/api/' + route, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Project-Map-Token': token },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '请求失败');
  return result;
}
type State = { graph: Graph; tasks: ChangeTask[]; error: string; scanning: boolean };
const labels: Record<string, string> = {
  pending: '待实施',
  'in-progress': '实施中',
  'needs-review': '待复核',
  verified: '结构已验证',
  cancelled: '已取消',
};
function App() {
  const [state, setState] = useState<State>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState('');
  const [selected, setSelected] = useState(''),
    [edgeId, setEdgeId] = useState(''),
    [query, setQuery] = useState(''),
    [focus, setFocus] = useState(false);
  const [panel, setPanel] = useState<'map' | 'tasks'>('map');
  const [modal, setModal] = useState<
    '' | 'open' | 'edit' | 'task' | 'integration' | 'source' | 'warnings'
  >('');
  const [projectPath, setProjectPath] = useState(''),
    [draft, setDraft] = useState<Feature>(),
    [intent, setIntent] = useState(''),
    [baseRevision, setBaseRevision] = useState('');
  const [source, setSource] = useState<{
      file: string;
      start: number;
      lines: string[];
      total: number;
    }>(),
    [integration, setIntegration] = useState(''),
    [fileQuery, setFileQuery] = useState('');
  const refresh = async () => {
    const next = await api<State>('state');
    setState(next);
  };
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    const timer = setInterval(() => void refresh().catch((e) => setError(e.message)), 3000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(''), 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModal('');
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast('已复制');
    } catch {
      setError('复制失败，请手动选择文本复制');
    }
  };
  if (!state)
    return (
      <div className="loading">
        <div className="brand-mark">M</div>
        <h2>正在绘制项目地图</h2>
        <p>{error || '读取源码与依赖关系…'}</p>
      </div>
    );
  const { graph: g, tasks } = state;
  const feature = g.features.find((f) => f.id === selected),
    edge = g.relations.find((e) => e.id === edgeId);
  const name = (id: string) => g.features.find((f) => f.id === id)?.name || id;
  const connected = feature
    ? g.relations.filter((e) => e.source === feature.id || e.target === feature.id)
    : [];
  const activeTasks = tasks.filter((t) => !['verified', 'cancelled'].includes(t.status));
  const showSource = (file: string, line = 1) =>
    void run(async () => {
      setSource(await api('source?file=' + encodeURIComponent(file) + '&line=' + line));
      setModal('source');
    });
  const edit = (f?: Feature) => {
    setDraft(
      f
        ? structuredClone(f)
        : {
            id: 'f-' + crypto.randomUUID(),
            name: '',
            description: '',
            files: [],
            source: 'manual',
          },
    );
    setFileQuery('');
    setBaseRevision(g.revision);
    setModal('edit');
  };
  const integrate = () =>
    void run(async () => {
      const config = await api('integration');
      setIntegration(
        '[mcp_servers.module_map]\ncommand = ' +
          JSON.stringify(config.command) +
          '\nargs = ' +
          JSON.stringify(config.args),
      );
      setModal('integration');
    });
  return (
    <div className="app">
      <header>
        <div className="brand">
          <div className="brand-mark">
            M<span>·</span>
          </div>
          <div>
            <strong>模块地图</strong>
            <small>MODULE MAP</small>
          </div>
        </div>
        <div className="project-crumb">
          <span>本地项目</span>
          <b>/</b>
          <strong title={g.root}>{g.name}</strong>
        </div>
        <div className="header-actions">
          <span className={'live ' + (state.error ? 'warning' : '')}>
            <i />
            {state.error ? '同步异常' : state.scanning ? '同步中' : '自动同步'}
          </span>
          <button onClick={integrate}>连接 AI ↗</button>
          <button
            className="primary"
            onClick={() => {
              setProjectPath(g.root);
              setModal('open');
            }}
          >
            打开项目
          </button>
        </div>
      </header>
      <nav className="topbar">
        <div className="tabs">
          <button className={panel === 'map' ? 'active' : ''} onClick={() => setPanel('map')}>
            ◉ 功能地图
          </button>
          <button className={panel === 'tasks' ? 'active' : ''} onClick={() => setPanel('tasks')}>
            ☷ 修改任务 <em>{activeTasks.length}</em>
          </button>
        </div>
        <div className="revision">
          <span>版本 {g.revision.slice(0, 8)}</span>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api('scan', {});
                setToast('地图已更新');
              })
            }
          >
            ↻ 重新扫描
          </button>
        </div>
      </nav>
      {(error || state.error) && (
        <div className="error" role="alert">
          {error || state.error}
          <button onClick={() => setError('')}>×</button>
        </div>
      )}
      {panel === 'map' ? (
        <main className="workspace">
          <aside className="sidebar">
            <div className="section-heading">
              <span>功能索引</span>
              <button title="新增功能" onClick={() => edit()}>
                ＋
              </button>
            </div>
            <div className="search">
              <span>⌕</span>
              <input
                aria-label="搜索功能或文件"
                placeholder="搜索功能或文件…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="feature-list">
              {g.features
                .filter((f) =>
                  [f.name, f.description, ...f.files]
                    .join(' ')
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                )
                .map((f, i) => (
                  <button
                    className={'feature-item ' + (selected === f.id ? 'active' : '')}
                    key={f.id}
                    onClick={() => {
                      setSelected(f.id);
                      setEdgeId('');
                    }}
                  >
                    <span className="feature-number">{String(i + 1).padStart(2, '0')}</span>
                    <span>
                      <b>{f.name}</b>
                      <small>
                        {f.files.length} 个文件 ·{' '}
                        {f.source === 'directory'
                          ? '目录归类'
                          : f.source === 'ai'
                            ? 'AI 归类'
                            : '人工归类'}
                      </small>
                    </span>
                  </button>
                ))}
            </div>
            <div className="sidebar-bottom">
              <div className="stats">
                <div>
                  <strong>{g.files.length}</strong>
                  <span>源码文件</span>
                </div>
                <div>
                  <strong>{g.relations.length}</strong>
                  <span>功能依赖</span>
                </div>
              </div>
              <button className="warning-link" onClick={() => setModal('warnings')}>
                分析说明 {g.warnings.length ? '· ' + g.warnings.length + ' 条提示' : '↗'}
              </button>
              <p>
                静态导入图 · JS / TS
                <br />
                功能分组可随项目逐步完善
              </p>
            </div>
          </aside>
          <section className="canvas-section">
            <div className="canvas-tools">
              <label>
                <input
                  type="checkbox"
                  checked={focus}
                  onChange={(e) => setFocus(e.target.checked)}
                />
                仅看所选功能及邻居
              </label>
            </div>
            <GraphView
              graph={g}
              selected={selected}
              edgeSelected={edgeId}
              onNode={(id) => {
                setSelected(id);
                setEdgeId('');
              }}
              onEdge={(id) => {
                setEdgeId(id);
                setSelected('');
              }}
              query={query}
              focus={focus}
            />
          </section>
          <aside className="details">
            {edge ? (
              <>
                <span className="eyebrow">DEPENDENCY</span>
                <h2>依赖关系</h2>
                <div className="relation-card">
                  <strong>{name(edge.source)}</strong>
                  <span>↓ 依赖</span>
                  <strong>{name(edge.target)}</strong>
                </div>
                <div className="section-heading">
                  源码证据 <em>{edge.evidence.length}</em>
                </div>
                <div className="evidence-list">
                  {edge.evidence.map((e, i) => (
                    <button className="evidence" key={i} onClick={() => showSource(e.file, e.line)}>
                      <b>
                        {e.file}:{e.line}
                      </b>
                      <code>{e.specifier}</code>
                      <small>
                        {e.kind === 'type' ? '类型引用' : e.kind} → {e.target}
                      </small>
                    </button>
                  ))}
                </div>
                <div className="impact">
                  <strong>如果取消这条依赖</strong>
                  <p>
                    需要处理上述 {edge.evidence.length} 处引用。目标功能还有{' '}
                    {
                      g.relations.filter(
                        (e) => e.target === edge.target && e.source !== edge.source,
                      ).length
                    }{' '}
                    个其他使用方。
                  </p>
                </div>
                <button
                  className="danger-outline full"
                  onClick={() => {
                    setIntent(
                      '取消“' +
                        name(edge.source) +
                        '”对“' +
                        name(edge.target) +
                        '”的依赖，并保留其他使用方的行为。',
                    );
                    setBaseRevision(g.revision);
                    setModal('task');
                  }}
                >
                  × 叉掉连线 · 创建修改任务
                </button>
                <p className="hint">连线将在代码实际修改并重新扫描后消失。</p>
              </>
            ) : feature ? (
              <>
                <span className="eyebrow">FEATURE DETAIL</span>
                <div className="detail-title">
                  <h2>{feature.name}</h2>
                  <button onClick={() => edit(feature)}>编辑</button>
                </div>
                <span className="pill">
                  {feature.source === 'directory'
                    ? '目录归类 · 业务含义待确认'
                    : feature.source === 'ai'
                      ? 'AI 归类 · 请核对'
                      : '人工归类'}
                </span>
                <p className="description">{feature.description || '尚未添加功能说明'}</p>
                <div className="mini-stats">
                  <span>
                    <b>{feature.files.length}</b> 文件
                  </span>
                  <span>
                    <b>{connected.length}</b> 关联
                  </span>
                </div>
                <div className="section-heading">对应代码</div>
                <div className="file-list">
                  {feature.files.map((file) => (
                    <button key={file} onClick={() => showSource(file)}>
                      <span>⌘</span>
                      <span>{file}</span>
                      <small>↗</small>
                    </button>
                  ))}
                </div>
                <div className="section-heading">关联功能</div>
                {connected.map((e) => (
                  <button
                    className="dependency-item"
                    key={e.id}
                    onClick={() => {
                      setSelected('');
                      setEdgeId(e.id);
                    }}
                  >
                    <span>{e.source === feature.id ? '依赖 →' : '使用方 ←'}</span>
                    {name(e.source === feature.id ? e.target : e.source)}
                  </button>
                ))}
                {!connected.length && <p className="hint">暂无跨功能导入依赖</p>}
              </>
            ) : (
              <div className="detail-empty">
                <div className="orbit-icon">◎</div>
                <h3>从一个功能开始</h3>
                <p>
                  点击圆圈查看对应代码，
                  <br />
                  点击连线查看依赖证据。
                </p>
                <div className="guide">
                  <b>01</b>
                  <span>理解功能与代码的对应关系</span>
                  <b>02</b>
                  <span>查看改动会影响哪些功能</span>
                  <b>03</b>
                  <span>交给 AI 实施，再核实结果</span>
                </div>
              </div>
            )}
          </aside>
        </main>
      ) : (
        <main className="tasks-page">
          <div className="page-title">
            <div>
              <span className="eyebrow">CHANGE WORKSPACE</span>
              <h1>让每一次改动都有迹可循</h1>
              <p>图上提出意图，由 AI 实施，再用代码验证结构变化。</p>
            </div>
            <button onClick={integrate}>配置 MCP 连接 ↗</button>
          </div>
          {!tasks.length ? (
            <div className="tasks-empty">
              <span>↗</span>
              <h2>还没有修改任务</h2>
              <p>在功能地图中选择一条连线，创建第一项修改任务。</p>
              <button className="primary" onClick={() => setPanel('map')}>
                前往功能地图
              </button>
            </div>
          ) : (
            tasks.map((t) => (
              <article className="task-card" key={t.id}>
                <div className="task-head">
                  <span className={'pill status-' + t.status}>{labels[t.status]}</span>
                  <small>{new Date(t.createdAt).toLocaleString('zh-CN')}</small>
                </div>
                <h3>{t.title}</h3>
                <p>{t.intent}</p>
                <div className="task-meta">
                  {t.evidence.length} 处原始引用 · 基线 {t.baseRevision.slice(0, 8)}{' '}
                  {t.status === 'pending' && t.baseRevision !== g.revision && (
                    <b className="stale">基线过期，请重建任务</b>
                  )}
                  {t.observedRevision && t.observedRevision !== g.revision && (
                    <b className="stale">验证记录对应历史版本</b>
                  )}
                </div>
                {t.summary && (
                  <p className="result">
                    {t.summary}
                    <small>{t.verification}</small>
                  </p>
                )}
                {t.checks.map((c, i) => (
                  <div className="check" key={i}>
                    <span>{c.outcome === 'passed' ? '✓' : c.outcome === 'failed' ? '×' : '—'}</span>
                    <code>{c.command}</code>
                    <small>{c.detail}</small>
                  </div>
                ))}
                <div className="task-actions">
                  <button
                    onClick={() =>
                      void copy(
                        '请使用 module_map MCP 处理任务 ' +
                          t.id +
                          '。先读取地图和任务，领取任务后再修改代码，执行相关检查，最后回填真实结果。',
                      )
                    }
                  >
                    复制给 AI 的指令
                  </button>
                  {!['verified', 'cancelled'].includes(t.status) && (
                    <button
                      onClick={() =>
                        void run(async () => {
                          await api('tasks/cancel', { id: t.id });
                        })
                      }
                    >
                      取消任务
                    </button>
                  )}
                </div>
              </article>
            ))
          )}
        </main>
      )}
      <footer>
        <span>LOCAL FIRST / 代码在本地分析</span>
        <span>
          {g.name} · {g.features.length} 个功能 · {g.imports.length} 条源码依赖
        </span>
      </footer>
      {toast && (
        <div className="toast" role="status">
          ✓ {toast}
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModal('');
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="项目操作"
            className={'modal ' + (modal === 'edit' || modal === 'source' ? 'wide' : '')}
          >
            <button aria-label="关闭" className="close" onClick={() => setModal('')}>
              ×
            </button>
            {modal === 'open' && (
              <>
                <span className="eyebrow">OPEN PROJECT</span>
                <h2>打开一个本地项目</h2>
                <p>输入目录的完整路径。扫描不会修改业务代码。</p>
                <label className="field">
                  项目路径
                  <input
                    autoFocus
                    value={projectPath}
                    onChange={(e) => setProjectPath(e.target.value)}
                    placeholder="C:\\Projects\\my-app"
                  />
                </label>
                <button
                  className="primary full"
                  disabled={busy || !projectPath.trim()}
                  onClick={() =>
                    void run(async () => {
                      await api('open', { path: projectPath.trim() });
                      setSelected('');
                      setEdgeId('');
                      setQuery('');
                      setModal('');
                    })
                  }
                >
                  {busy ? '正在分析…' : '打开并生成地图'}
                </button>
              </>
            )}
            {modal === 'edit' && draft && (
              <>
                <span className="eyebrow">FEATURE MAPPING</span>
                <h2>{g.features.some((f) => f.id === draft.id) ? '编辑功能' : '创建功能'}</h2>
                <div className="form-row">
                  <label className="field">
                    功能名称
                    <input
                      autoFocus
                      value={draft.name}
                      maxLength={100}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    说明
                    <input
                      value={draft.description}
                      maxLength={2000}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    />
                  </label>
                </div>
                <label className="field">
                  关联源码 · 已选 {draft.files.length} 个
                  <input
                    placeholder="筛选文件…"
                    value={fileQuery}
                    onChange={(e) => setFileQuery(e.target.value)}
                  />
                </label>
                <div className="file-picker">
                  {g.files
                    .filter((f) => f.path.toLowerCase().includes(fileQuery.toLowerCase()))
                    .map((f) => (
                      <label key={f.path}>
                        <input
                          type="checkbox"
                          checked={draft.files.includes(f.path)}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              files: e.target.checked
                                ? [...draft.files, f.path]
                                : draft.files.filter((p) => p !== f.path),
                            })
                          }
                        />
                        <span>{f.path}</span>
                      </label>
                    ))}
                </div>
                <p className="hint">文件可以属于多个功能。保存后，未归类的新文件进入“待归类”。</p>
                <button
                  className="primary full"
                  disabled={busy || !draft.name.trim()}
                  onClick={() =>
                    void run(async () => {
                      const next = g.features.filter(
                        (f) => f.id !== draft.id && f.id !== '__unassigned',
                      );
                      next.push({
                        ...draft,
                        source: 'manual',
                        id: draft.id === '__unassigned' ? 'f-' + crypto.randomUUID() : draft.id,
                      });
                      await api('features', { features: next, revision: baseRevision });
                      setModal('');
                      setToast('功能映射已保存');
                    })
                  }
                >
                  保存功能映射
                </button>
              </>
            )}
            {modal === 'task' && (
              <>
                <span className="eyebrow">CHANGE INTENT</span>
                <h2>把修改意图交给 AI</h2>
                <p>创建任务后，当前代码和连线保持原状，直到 AI 完成修改。</p>
                <label className="field">
                  你希望如何调整？
                  <textarea
                    autoFocus
                    rows={5}
                    value={intent}
                    maxLength={4000}
                    onChange={(e) => setIntent(e.target.value)}
                  />
                </label>
                <p className="hint">
                  影响预览：{edge?.evidence.length || 0}{' '}
                  处直接引用。动态调用和运行时副作用仍需执行方检查。
                </p>
                <button
                  className="primary full"
                  disabled={busy || !intent.trim()}
                  onClick={() =>
                    void run(async () => {
                      await api('tasks', { relationId: edgeId, intent, revision: baseRevision });
                      setModal('');
                      setPanel('tasks');
                      setToast('任务已创建');
                    })
                  }
                >
                  创建待实施任务
                </button>
              </>
            )}
            {modal === 'integration' && (
              <>
                <span className="eyebrow">AI CONNECTION</span>
                <h2>让 AI 读懂这张地图</h2>
                <p>将下面配置加入 Codex 的 MCP 配置，重新连接后即可使用。配置绑定当前项目。</p>
                <pre className="config">{integration}</pre>
                <button className="primary" onClick={() => void copy(integration)}>
                  复制配置
                </button>
                <div className="integration-steps">
                  <p>
                    <b>1</b> 连接后，让 AI 调用 get_project_graph 理解项目。
                  </p>
                  <p>
                    <b>2</b> 在地图创建任务，复制任务指令到 Codex。
                  </p>
                  <p>
                    <b>3</b> AI 领取任务、修改代码、检查并回填结果。
                  </p>
                </div>
                <p className="hint">
                  也可接入支持 stdio MCP
                  的其他编程工具。切换项目后需使用对应配置。分析在本地进行；AI
                  调用接口时会读取所请求的代码和地图。
                </p>
              </>
            )}
            {modal === 'source' && source && (
              <>
                <span className="eyebrow">SOURCE EVIDENCE</span>
                <h2 className="source-title">{source.file}</h2>
                <p>附近代码 · 共 {source.total} 行</p>
                <pre className="source-code">
                  {source.lines.map((line, i) => (
                    <div key={i}>
                      <span>{source.start + i}</span>
                      <code>{line || ' '}</code>
                    </div>
                  ))}
                </pre>
              </>
            )}
            {modal === 'warnings' && (
              <>
                <span className="eyebrow">ANALYSIS COVERAGE</span>
                <h2>这张图能说明什么</h2>
                <p>
                  已分析 {g.files.length} 个 JS/TS 文件，提取 {g.imports.length} 条项目内依赖。
                  {g.externalImports} 条外部或未解析的非相对引用未纳入功能图。
                </p>
                <p>
                  支持静态导入、导出转发、字面量 require / 动态 import，以及 tsconfig
                  路径解析。当前未构建函数调用图，也不推断运行时行为。
                </p>
                <p>
                  每 3 秒重新扫描源码并校准地图。忽略依赖目录、构建目录、符号链接和 .gitignore
                  匹配项。
                </p>
                <p>
                  任务的“结构已验证”表示原始静态依赖消失且执行方回填了通过记录；本工具不会独立执行这些命令。
                </p>
                <div className="warnings">
                  {g.warnings.map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                </div>
              </>
            )}
            {error && (
              <p className="modal-error" role="alert">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
