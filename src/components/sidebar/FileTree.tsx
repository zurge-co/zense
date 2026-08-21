import { useState, useRef, useEffect } from "react";
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  Copy,
  ClipboardPaste,
  Files,
  RefreshCw,
} from "lucide-react";
import { type FileNode } from "../../lib/mockData";
import { useUIStore } from "../../store/uiStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useGitStore } from "../../store/gitStore";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import { ConfirmDialog } from "../ConfirmDialog";

export function FileTree() {
  const fileTree = useWorkspaceStore((s) => s.fileTree);
  const workspaceName = useUIStore((s) => s.workspaceName);
  const workspacePath = useUIStore((s) => s.workspacePath);
  const refreshTree = useWorkspaceStore((s) => s.refreshTree);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (!workspacePath || refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([
        refreshTree(workspacePath),
        useGitStore.getState().refresh(workspacePath),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="pb-4" onContextMenu={(e) => e.preventDefault()}>
      <Section
        title={workspaceName ?? "workspace"}
        defaultOpen
        action={
          workspacePath ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                void handleRefresh();
              }}
              className="mr-1 shrink-0 text-fg-muted hover:text-fg"
              title="Refresh"
            >
              <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            </button>
          ) : null
        }
      >
        {fileTree.map((node) => (
          <TreeNode key={node.path} node={node} depth={0} />
        ))}
      </Section>
    </div>
  );
}

function Section({
  title,
  defaultOpen,
  action,
  children,
}: {
  title: string;
  defaultOpen: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-1">
      <div className="flex items-center pr-1">
        <button
          onClick={() => setOpen(!open)}
          className="flex flex-1 items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-fg-muted hover:text-fg"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {title}
        </button>
        {action}
      </div>
      {open && children}
    </div>
  );
}

interface MenuState {
  x: number;
  y: number;
  node: FileNode;
}

interface InlineEdit {
  mode: "create" | "rename";
  node?: FileNode;
  parentPath: string;
  isDir: boolean;
}

/** Parent directory for paste operations: folder → itself; file → its parent. */
function pasteDirFor(node: FileNode): string {
  if (node.type === "folder") return node.path;
  return node.path.includes("/") ? node.path.slice(0, node.path.lastIndexOf("/")) : ".";
}

function TreeNode({ node, depth }: { node: FileNode; depth: number }) {
  const [open, setOpen] = useState(depth === 0);
  const { selectedFile, openFile, workspacePath } = useUIStore();
  const { createEntry, renameEntry, deleteEntry, setSelectedTreeNode, copyNode, pasteNode, duplicateNode, setPendingRename, setPendingDelete } = useWorkspaceStore();
  const clipboard = useWorkspaceStore((s) => s.clipboard);
  const selectedTreeNode = useWorkspaceStore((s) => s.selectedTreeNode);
  const pendingRename = useWorkspaceStore((s) => s.pendingRename);
  const pendingDelete = useWorkspaceStore((s) => s.pendingDelete);
  const pad = { paddingLeft: `${depth * 12 + 12}px` };

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [inline, setInline] = useState<InlineEdit | null>(null);
  const [confirmDel, setConfirmDel] = useState<{ path: string; type: "file" | "folder" } | null>(null);

  const isClipboardNode = clipboard?.path === node.path;
  const isTreeSelected = selectedTreeNode?.path === node.path;

  // Keyboard shortcut: F2 → rename
  useEffect(() => {
    if (pendingRename === node.path) {
      setInline({ mode: "rename", node, parentPath: "", isDir: node.type === "folder" });
      setPendingRename(null);
    }
  }, [pendingRename, node.path, node.type, setPendingRename, node]);

  // Keyboard shortcut: Delete → confirm dialog
  useEffect(() => {
    if (pendingDelete?.path === node.path) {
      setConfirmDel({ path: node.path, type: node.type });
      setPendingDelete(null);
    }
  }, [pendingDelete, node.path, node.type, setPendingDelete]);

  const startCreate = (isDir: boolean) => {
    const parentPath = node.type === "folder" ? node.path : "";
    setInline({ mode: "create", parentPath, isDir });
    if (node.type === "folder") setOpen(true);
  };

  const menuItems: ContextMenuItem[] = menu
    ? [
        { id: "new-file", label: "New File", icon: FilePlus, onClick: () => startCreate(false) },
        { id: "new-folder", label: "New Folder", icon: FolderPlus, onClick: () => startCreate(true) },
        { id: "copy", label: "Copy", icon: Copy, onClick: () => { copyNode(node.path, node.type); setSelectedTreeNode({ path: node.path, type: node.type }); } },
        {
          id: "paste",
          label: "Paste",
          icon: ClipboardPaste,
          onClick: () => {
            if (workspacePath) void pasteNode(workspacePath, pasteDirFor(menu.node));
          },
          disabled: !clipboard,
        },
        { id: "duplicate", label: "Duplicate", icon: Files, onClick: () => { setSelectedTreeNode({ path: node.path, type: node.type }); if (workspacePath) void duplicateNode(workspacePath); } },
        { id: "rename", label: "Rename", icon: Pencil, onClick: () => setInline({ mode: "rename", node: menu.node, parentPath: "", isDir: menu.node.type === "folder" }) },
        {
          id: "delete",
          label: "Delete",
          icon: Trash2,
          onClick: () => setConfirmDel({ path: menu.node.path, type: menu.node.type }),
        },
      ]
    : [];

  const handleSelect = () => {
    setSelectedTreeNode({ path: node.path, type: node.type });
  };

  if (node.type === "folder") {
    return (
      <>
        <button
          onClick={() => { setOpen(!open); handleSelect(); }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleSelect();
            setMenu({ x: e.clientX, y: e.clientY, node });
          }}
          style={pad}
          className={`flex w-full items-center gap-1.5 py-0.5 pr-2 text-[12.5px] hover:bg-hover hover:text-fg ${
            isTreeSelected ? "bg-active text-fg" : "text-fg-muted"
          } ${isClipboardNode ? "opacity-50" : ""}`}
        >
          <span className="text-fg-muted">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          {open ? (
            <FolderOpen size={14} className="shrink-0 text-accent" />
          ) : (
            <Folder size={14} className="shrink-0 text-accent" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {open && (
          <>
            {node.children?.map((child) => <TreeNode key={child.path} node={child} depth={depth + 1} />)}
            {inline && inline.parentPath === node.path && (
              <InlineInput
                depth={depth + 1}
                isDir={inline.isDir}
                placeholder={inline.isDir ? "folder name" : "file name"}
                onCancel={() => setInline(null)}
                onSubmit={async (name) => {
                  if (!workspacePath || !name.trim()) return;
                  const fullPath = inline.parentPath ? `${inline.parentPath}/${name}` : name;
                  try {
                    await createEntry(workspacePath, fullPath, inline.isDir);
                  } catch (err) {
                    console.error("create failed:", err);
                  }
                  setInline(null);
                }}
              />
            )}
          </>
        )}
        {menu && (
          <ContextMenu items={menuItems} position={{ x: menu.x, y: menu.y }} onClose={() => setMenu(null)} />
        )}
        {confirmDel && (
          <ConfirmDialog
            title={`Delete ${confirmDel.type === "folder" ? "Folder" : "File"}`}
            message={`Delete "${confirmDel.path}"? This cannot be undone.`}
            confirmLabel="Delete"
            danger
            onConfirm={async () => {
              if (workspacePath) {
                try {
                  await deleteEntry(workspacePath, confirmDel.path);
                } catch (err) {
                  console.error("delete failed:", err);
                }
              }
              setConfirmDel(null);
            }}
            onCancel={() => setConfirmDel(null)}
          />
        )}
      </>
    );
  }

  const selected = selectedFile === node.path;
  return (
    <>
      <button
        onClick={() => { openFile(node.path); handleSelect(); }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleSelect();
          setMenu({ x: e.clientX, y: e.clientY, node });
        }}
        style={pad}
        className={`group flex w-full items-center gap-1.5 py-0.5 pl-6 pr-2 text-[12.5px] ${
          selected ? "bg-active text-fg" : isTreeSelected ? "bg-hover text-fg" : "text-fg-muted hover:bg-hover hover:text-fg"
        } ${isClipboardNode ? "opacity-50" : ""}`}
      >
        <File size={14} className="shrink-0 text-fg-muted" />
        <span className="flex-1 truncate text-left">{node.name}</span>
      </button>
      {inline && inline.mode === "rename" && inline.node?.path === node.path && (
        <InlineInput
          depth={depth}
          isDir={false}
          initialValue={node.name}
          placeholder="new name"
          onCancel={() => setInline(null)}
          onSubmit={async (name) => {
            if (!workspacePath || !name.trim()) return;
            const parent = node.path.includes("/") ? node.path.slice(0, node.path.lastIndexOf("/")) : "";
            const fullPath = parent ? `${parent}/${name}` : name;
            if (fullPath !== node.path) {
              try {
                await renameEntry(workspacePath, node.path, fullPath);
              } catch (err) {
                console.error("rename failed:", err);
              }
            }
            setInline(null);
          }}
        />
      )}
      {menu && (
        <ContextMenu items={menuItems} position={{ x: menu.x, y: menu.y }} onClose={() => setMenu(null)} />
      )}
      {confirmDel && (
        <ConfirmDialog
          title="Delete File"
          message={`Delete "${confirmDel.path}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={async () => {
            if (workspacePath) {
              try {
                await deleteEntry(workspacePath, confirmDel.path);
              } catch (err) {
                console.error("delete failed:", err);
              }
            }
            setConfirmDel(null);
          }}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </>
  );
}

function InlineInput({
  depth,
  isDir,
  initialValue,
  placeholder,
  onSubmit,
  onCancel,
}: {
  depth: number;
  isDir: boolean;
  initialValue?: string;
  placeholder: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <div
      className="flex items-center gap-1.5 py-0.5 pr-2 text-[12.5px]"
      style={{ paddingLeft: `${depth * 12 + 12}px` }}
    >
      {isDir ? (
        <Folder size={14} className="shrink-0 text-accent" />
      ) : (
        <File size={14} className="shrink-0 text-fg-muted" />
      )}
      <input
        ref={ref}
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit(value);
          if (e.key === "Escape") onCancel();
        }}
        onBlur={() => {
          if (value.trim()) onSubmit(value);
          else onCancel();
        }}
        className="w-full rounded border border-accent bg-base px-1 py-0.5 text-[12.5px] text-fg outline-none"
      />
    </div>
  );
}
