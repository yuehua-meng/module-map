import { useRef, useState } from 'react';
import type { Graph } from '../../../packages/core/types';
export function GraphView({
  graph,
  selected,
  edgeSelected,
  onNode,
  onEdge,
  query,
  focus,
}: {
  graph: Graph;
  selected: string;
  edgeSelected: string;
  onNode: (id: string) => void;
  onEdge: (id: string) => void;
  query: string;
  focus: boolean;
}) {
  const [view, setView] = useState({ x: 0, y: 0, z: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const features = graph.features;
  const adjacent = new Set([
    selected,
    ...graph.relations
      .filter((e) => e.source === selected || e.target === selected)
      .flatMap((e) => [e.source, e.target]),
  ]);
  const visible = features.filter(
    (f) =>
      (!focus || !selected || adjacent.has(f.id)) &&
      (!query ||
        [f.name, f.description, ...f.files].join(' ').toLowerCase().includes(query.toLowerCase())),
  );
  const n = visible.length;
  const positions = new Map(
    visible.map((f, i) => {
      if (n === 1) return [f.id, { x: 500, y: 320 }];
      if (n <= 10) {
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
        return [
          f.id,
          {
            x: 500 + Math.cos(angle) * Math.min(320, 120 + n * 22),
            y: 320 + Math.sin(angle) * Math.min(225, 100 + n * 16),
          },
        ];
      }
      const cols = Math.ceil(Math.sqrt(n * 1.6)),
        rows = Math.ceil(n / cols);
      return [
        f.id,
        {
          x: 110 + ((i % cols) * 780) / Math.max(1, cols - 1),
          y: 95 + (Math.floor(i / cols) * 460) / Math.max(1, rows - 1),
        },
      ];
    }),
  );
  return (
    <div className="graph-wrap">
      <div className="canvas-title">
        <span className="eyebrow">FEATURE TOPOLOGY</span>
        <h2>{focus ? '关联视图' : '功能关系图'}</h2>
        <p>箭头表示依赖方向 · 点击连线查看源码证据</p>
      </div>
      {!n ? (
        <div className="empty graph-empty">
          没有匹配的功能
          {graph.files.length === 0 && (
            <small>当前支持 JS / TS 源码。可从左上角打开其他项目。</small>
          )}
        </div>
      ) : (
        <svg
          className="graph"
          viewBox="0 0 1000 640"
          aria-label="功能依赖关系图"
          onWheel={(e) =>
            setView((v) => ({ ...v, z: Math.min(2.5, Math.max(0.4, v.z - e.deltaY * 0.001)) }))
          }
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
              e.currentTarget.setPointerCapture(e.pointerId);
            }
          }}
          onPointerMove={(e) => {
            if (drag.current) {
              const scale = 1000 / e.currentTarget.getBoundingClientRect().width;
              setView((v) => ({
                ...v,
                x: drag.current!.vx + (e.clientX - drag.current!.x) * scale,
                y: drag.current!.vy + (e.clientY - drag.current!.y) * scale,
              }));
            }
          }}
          onPointerUp={() => (drag.current = null)}
        >
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#93a8a1" />
            </marker>
            <marker
              id="arrow-selected"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#d3794c" />
            </marker>
          </defs>
          <g
            transform={`translate(${500 + view.x} ${320 + view.y}) scale(${view.z}) translate(-500 -320)`}
          >
            {graph.relations.map((edge) => {
              const a = positions.get(edge.source),
                b = positions.get(edge.target);
              if (!a || !b) return null;
              const dx = b.x - a.x,
                dy = b.y - a.y,
                len = Math.hypot(dx, dy) || 1;
              const sx = a.x + (dx / len) * 43,
                sy = a.y + (dy / len) * 43,
                tx = b.x - (dx / len) * 48,
                ty = b.y - (dy / len) * 48;
              const bend = graph.relations.some(
                (e) => e.source === edge.target && e.target === edge.source,
              )
                ? 24
                : 0;
              const cx = (sx + tx) / 2 - (dy / len) * bend,
                cy = (sy + ty) / 2 + (dx / len) * bend;
              const d = `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`,
                active = edge.id === edgeSelected;
              return (
                <g
                  key={edge.id}
                  className={'edge ' + (active ? 'active' : '')}
                  role="button"
                  tabIndex={0}
                  aria-label={`${features.find((f) => f.id === edge.source)?.name} 依赖 ${features.find((f) => f.id === edge.target)?.name}`}
                  onClick={() => onEdge(edge.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onEdge(edge.id);
                  }}
                >
                  <path d={d} className="edge-hit" />
                  <circle
                    cx={(sx + 2 * cx + tx) / 4}
                    cy={(sy + 2 * cy + ty) / 4}
                    r="10"
                    fill="transparent"
                  />
                  <path
                    d={d}
                    className="edge-line"
                    markerEnd={active ? 'url(#arrow-selected)' : 'url(#arrow)'}
                  />
                  {active && (
                    <g transform={`translate(${cx},${cy})`}>
                      <circle r="13" fill="#fcf7ef" stroke="#d3794c" />
                      <text y="4" textAnchor="middle" fontSize="12" fill="#a85e36">
                        {edge.evidence.length}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
            {visible.map((f, i) => {
              const p = positions.get(f.id)!;
              const active = f.id === selected;
              return (
                <g
                  key={f.id}
                  transform={`translate(${p.x} ${p.y})`}
                  className={'node ' + (active ? 'selected' : '')}
                  role="button"
                  tabIndex={0}
                  aria-label={'功能 ' + f.name}
                  onClick={() => onNode(f.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onNode(f.id);
                  }}
                >
                  <circle className="node-halo" r="49" />
                  <circle className="node-body" r="39" />
                  <text textAnchor="middle" y="6" className="node-index">
                    {String(i + 1).padStart(2, '0')}
                  </text>
                  <circle cx="30" cy="-26" r="6" className={'node-dot ' + f.source} />
                  <text textAnchor="middle" y="66" className="node-name">
                    {f.name.length > 19 ? f.name.slice(0, 18) + '…' : f.name}
                  </text>
                  <text textAnchor="middle" y="84" className="node-meta">
                    {f.files.length} 个文件
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      )}
      <div className="canvas-footer">
        <span>
          <i className="legend-dot" />
          目录归类
        </span>
        <span>
          <i className="legend-dot manual" />
          人工 / AI 归类
        </span>
        <div className="zoom-controls">
          <button
            aria-label="缩小"
            onClick={() => setView((v) => ({ ...v, z: Math.max(0.4, v.z - 0.15) }))}
          >
            −
          </button>
          <button onClick={() => setView({ x: 0, y: 0, z: 1 })}>{Math.round(view.z * 100)}%</button>
          <button
            aria-label="放大"
            onClick={() => setView((v) => ({ ...v, z: Math.min(2.5, v.z + 0.15) }))}
          >
            ＋
          </button>
        </div>
      </div>
    </div>
  );
}
