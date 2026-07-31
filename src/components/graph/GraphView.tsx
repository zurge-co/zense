import { useState } from "react";
import {
  Network,
  Search,
  ZoomIn,
  ZoomOut,
  Maximize,
  X,
  FileCode,
} from "lucide-react";
import { graphNodes, graphEdges, graphTypes, type GraphNode } from "../../lib/mockData";
import { useUIStore } from "../../store/uiStore";

const NODE_W = 130;
const NODE_H = 34;

export function GraphView() {
  const [graphType, setGraphType] = useState(graphTypes[0]);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const { openFile, setActivity } = useUIStore();

  const byId = Object.fromEntries(graphNodes.map((n) => [n.id, n]));

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-base">
      {/* Toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-2">
          <Network size={13} className="text-accent-2" />
          Code Graph
        </span>

        <div className="ml-2 flex items-center gap-0.5 rounded border border-line bg-base p-0.5 text-[11.5px]">
          {graphTypes.map((t) => (
            <button
              key={t}
              onClick={() => setGraphType(t)}
              className={`rounded px-2 py-1 ${
                graphType === t ? "bg-active text-fg" : "text-fg-3 hover:text-fg-2"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded border border-line bg-base px-2 focus-within:border-accent">
          <Search size={12} className="text-fg-3" />
          <input
            placeholder="Find node…"
            className="w-36 bg-transparent py-1 text-[12px] text-fg outline-none placeholder:text-fg-3"
          />
        </div>

        <div className="flex-1" />

        <span className="text-[11px] text-fg-3">
          {graphNodes.length} nodes · {graphEdges.length} edges · depth 2
        </span>
      </div>

      {/* Canvas */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <svg
          viewBox="0 0 700 580"
          className="h-full w-full"
          style={{
            backgroundImage: "radial-gradient(circle, #1c2432 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        >
          <defs>
            <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="#3d4a61" />
            </marker>
          </defs>

          {graphEdges.map(([from, to]) => {
            const a = byId[from];
            const b = byId[to];
            const x1 = a.x;
            const y1 = a.y + NODE_H;
            const x2 = b.x;
            const y2 = b.y;
            const my = (y1 + y2) / 2;
            return (
              <path
                key={`${from}-${to}`}
                d={`M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2 - 4}`}
                fill="none"
                stroke="#2b3648"
                strokeWidth={1.5}
                markerEnd="url(#arrow)"
              />
            );
          })}

          {graphNodes.map((n) => {
            const active = selected?.id === n.id;
            return (
              <g
                key={n.id}
                className="cursor-pointer"
                onClick={() => setSelected(active ? null : n)}
              >
                <rect
                  x={n.x - NODE_W / 2}
                  y={n.y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={6}
                  fill={active ? "#232d3f" : "#161c27"}
                  stroke={n.color}
                  strokeOpacity={active ? 1 : 0.45}
                  strokeWidth={active ? 1.6 : 1}
                />
                <circle cx={n.x - NODE_W / 2 + 14} cy={n.y + NODE_H / 2} r={3.5} fill={n.color} />
                <text
                  x={n.x - NODE_W / 2 + 24}
                  y={n.y + NODE_H / 2 + 3.5}
                  fontSize={11}
                  fill="#d7e0ee"
                  fontFamily="ui-monospace, monospace"
                >
                  {n.label}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Node detail popover */}
        {selected && (
          <div className="absolute left-4 top-4 w-64 rounded-lg border border-line-2 bg-panel p-3 shadow-xl">
            <div className="flex items-start justify-between">
              <span className="font-mono text-[13px] text-fg">{selected.label}</span>
              <button onClick={() => setSelected(null)} className="rounded p-0.5 text-fg-3 hover:bg-hover hover:text-fg-2">
                <X size={13} />
              </button>
            </div>
            <button
              onClick={() => {
                openFile(selected.file);
                setActivity("explorer");
              }}
              className="mt-2 flex w-full items-center gap-1.5 rounded border border-line bg-base px-2 py-1.5 text-left font-mono text-[11px] text-fg-2 hover:border-accent/50 hover:text-accent-2"
            >
              <FileCode size={12} className="shrink-0" />
              {selected.file}:{selected.line}
            </button>
          </div>
        )}

        {/* Zoom controls (mock) */}
        <div className="absolute bottom-4 right-4 flex flex-col gap-1">
          <button title="Zoom in" className="rounded border border-line bg-panel p-1.5 text-fg-2 hover:bg-hover">
            <ZoomIn size={14} />
          </button>
          <button title="Zoom out" className="rounded border border-line bg-panel p-1.5 text-fg-2 hover:bg-hover">
            <ZoomOut size={14} />
          </button>
          <button title="Fit to view" className="rounded border border-line bg-panel p-1.5 text-fg-2 hover:bg-hover">
            <Maximize size={14} />
          </button>
        </div>

        {/* Legend */}
        <div className="absolute bottom-4 left-4 flex gap-1 text-[10.5px]">
          {[
            ["#3fb950", "entry"],
            ["#4f8cff", "module"],
            ["#bc8cff", "function"],
            ["#d29922", "call"],
            ["#5d6b82", "external"],
          ].map(([color, label]) => (
            <span key={label} className="flex items-center gap-1 rounded bg-panel px-1.5 py-0.5 text-fg-2">
              <i className="h-2 w-2 rounded-full" style={{ background: color }} />
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
