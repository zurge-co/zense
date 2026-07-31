import { useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  Star,
  ListTree,
} from "lucide-react";
import { fileTree, outlineSymbols, type FileNode } from "../../lib/mockData";
import { useUIStore } from "../../store/uiStore";

export function FileTree() {
  return (
    <div className="pb-4">
      <Section title="api-gateway" defaultOpen>
        {fileTree.map((node) => (
          <TreeNode key={node.path} node={node} depth={0} />
        ))}
      </Section>
      <Section title="Favorites" defaultOpen={false}>
        <div className="px-3 py-1 text-[12px] text-fg-3">No favorites yet</div>
      </Section>
      <OutlineSection />
    </div>
  );
}

function Section({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-fg-2 hover:text-fg"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title}
      </button>
      {open && children}
    </div>
  );
}

function TreeNode({ node, depth }: { node: FileNode; depth: number }) {
  const [open, setOpen] = useState(depth === 0);
  const { selectedFile, openFile } = useUIStore();
  const pad = { paddingLeft: `${depth * 12 + 12}px` };

  if (node.type === "folder") {
    return (
      <>
        <button
          onClick={() => setOpen(!open)}
          style={pad}
          className="flex w-full items-center gap-1.5 py-0.5 pr-2 text-[12.5px] text-fg-2 hover:bg-hover hover:text-fg"
        >
          <span className="text-fg-3">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          {open ? (
            <FolderOpen size={14} className="shrink-0 text-accent-2" />
          ) : (
            <Folder size={14} className="shrink-0 text-accent-2" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {open && node.children?.map((child) => <TreeNode key={child.path} node={child} depth={depth + 1} />)}
      </>
    );
  }

  const selected = selectedFile === node.path;
  return (
    <button
      onClick={() => openFile(node.path)}
      style={pad}
      className={`group flex w-full items-center gap-1.5 py-0.5 pl-6 pr-2 text-[12.5px] ${
        selected ? "bg-active text-fg" : "text-fg-2 hover:bg-hover hover:text-fg"
      }`}
    >
      <File size={14} className="shrink-0 text-fg-3" />
      <span className="flex-1 truncate text-left">{node.name}</span>
      <Star size={11} className="shrink-0 text-fg-3 opacity-0 group-hover:opacity-100" />
    </button>
  );
}

function OutlineSection() {
  const { openTabs, activeTabKey } = useUIStore();
  const activeTab = openTabs.find((t) => `${t.kind}:${t.path}` === activeTabKey);
  const symbols =
    (activeTab?.kind === "file" && outlineSymbols[activeTab.path]) || [];

  return (
    <Section title="Outline" defaultOpen>
      {symbols.length === 0 ? (
        <div className="flex items-center gap-1.5 px-3 py-1 text-[12px] text-fg-3">
          <ListTree size={12} />
          No symbols found
        </div>
      ) : (
        symbols.map((s) => (
          <div
            key={s.name}
            className="flex w-full items-center gap-2 px-3 py-0.5 text-[12.5px] text-fg-2 hover:bg-hover hover:text-fg"
          >
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[9px] font-bold ${
                s.kind === "function"
                  ? "bg-purple/20 text-purple"
                  : s.kind === "class"
                    ? "bg-yellow/20 text-yellow"
                    : "bg-accent/20 text-accent-2"
              }`}
            >
              {s.kind === "function" ? "f" : s.kind === "class" ? "C" : s.kind === "interface" ? "I" : "v"}
            </span>
            <span className="flex-1 truncate">{s.name}</span>
            <span className="text-[10px] text-fg-3">:{s.line}</span>
          </div>
        ))
      )}
    </Section>
  );
}
