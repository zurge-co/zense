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
  Eye,
  Files,
  Link,
  RefreshCw,
} from "lucide-react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { type FileNode } from "../../lib/mockData";
import { writeClipboardText } from "../../lib/clipboard";
import { isPreviewablePath } from "../../lib/preview";
import { isTauri } from "../../lib/workspace";
import { useUIStore } from "../../store/uiStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useGitStore } from "../../store/gitStore";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import { ConfirmDialog } from "../ConfirmDialog";

const TREE_DRAG_MIME = "application/x-zense-file-tree-paths";

function dropTargetAt(position: { x: number; y: number }, scaleFactor: number): string | null {
  // WKWebView draggingLocation is already in webview CSS points even though
  // Tauri surfaces it as PhysicalPosition. Try CSS coordinates first on macOS;
  // other webviews generally provide physical pixels.
  const isMac = /mac/i.test(navigator.platform);
  const points = [
    { x: position.x, y: position.y },
    { x: position.x / scaleFactor, y: position.y / scaleFactor },
  ];
  if (!isMac) points.reverse();

  for (const point of points) {
    for (const element of document.elementsFromPoint(point.x, point.y)) {
      const target = element.closest?.("[data-file-drop-path]");
      if (target instanceof HTMLElement) {
        return target.dataset.fileDropPath ?? "";
      }
    }
  }
  return null;
}

function defaultExpandedPaths(nodes: FileNode[]): Set<string> {
  return new Set(nodes.filter((node) => node.type === "folder").map((node) => node.path));
}

function flattenVisibleNodes(nodes: FileNode[], expanded: Set<string>): FileNode[] {
  const out: FileNode[] = [];
  const visit = (items: FileNode[]) => {
    for (const node of items) {
      out.push(node);
      if (node.type === "folder" && expanded.has(node.path) && node.children) {
        visit(node.children);
      }
    }
  };
  visit(nodes);
  return out;
}

function isInternalTreeDrag(e: React.DragEvent<HTMLElement>): boolean {
  return Array.from(e.dataTransfer.types).includes(TREE_DRAG_MIME);
}

function internalDragPaths(e: React.DragEvent<HTMLElement>): string[] | null {
  const raw = e.dataTransfer.getData(TREE_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((p) => typeof p === "string") ? parsed : null;
  } catch {
    return null;
  }
}

export function FileTree() {
  const fileTree = useWorkspaceStore((s) => s.fileTree);
  const workspaceName = useUIStore((s) => s.workspaceName);
  const workspacePath = useUIStore((s) => s.workspacePath);
  const openFile = useUIStore((s) => s.openFile);
  const refreshTree = useWorkspaceStore((s) => s.refreshTree);
  const createEntry = useWorkspaceStore((s) => s.createEntry);
  const pendingCreate = useWorkspaceStore((s) => s.pendingCreate);
  const setPendingCreate = useWorkspaceStore((s) => s.setPendingCreate);
  const importEntries = useWorkspaceStore((s) => s.importEntries);
  const moveEntries = useWorkspaceStore((s) => s.moveEntries);
  const [refreshing, setRefreshing] = useState(false);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [expandedOverrides, setExpandedOverrides] = useState<Set<string> | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [anchorPath, setAnchorPath] = useState<string | null>(null);
  const expandedPaths = expandedOverrides ?? defaultExpandedPaths(fileTree);

  // Reset explorer-local selection and expansion on a workspace switch.
  useEffect(() => {
    setExpandedOverrides(null);
    setSelectedPaths(new Set());
    setAnchorPath(null);
    setDropTargetPath(null);
  }, [workspacePath]);

  // Native Finder drops do not dispatch browser drag/drop events in Tauri.
  // Use the webview's native event paths and hit-test the DOM at the cursor
  // to determine which folder row (or the workspace root) received the drop.
  useEffect(() => {
    if (!isTauri() || !workspacePath) return;

    let disposed = false;
    let nativeFileDragActive = false;
    const scaleFactor = window.devicePixelRatio || 1;
    const unlistenPromise = getCurrentWebview().onDragDropEvent((event) => {
      if (disposed) return;
      const payload = event.payload;
      if (payload.type === "enter") {
        nativeFileDragActive = payload.paths.length > 0;
        if (nativeFileDragActive) setDropTargetPath(dropTargetAt(payload.position, scaleFactor));
        return;
      }
      if (payload.type === "over") {
        if (nativeFileDragActive) setDropTargetPath(dropTargetAt(payload.position, scaleFactor));
        return;
      }
      if (payload.type === "leave") {
        nativeFileDragActive = false;
        setDropTargetPath(null);
        return;
      }

      const shouldImport = nativeFileDragActive;
      nativeFileDragActive = false;
      setDropTargetPath(null);
      if (!shouldImport) return;
      const target = dropTargetAt(payload.position, scaleFactor);
      if (target === null || payload.paths.length === 0) return;
      void importEntries(workspacePath, target, payload.paths).catch((err) => {
        console.error("import dropped files failed:", err);
      });
    });

    return () => {
      disposed = true;
      setDropTargetPath(null);
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, [workspacePath, importEntries]);

  const setFolderExpanded = (path: string, expanded: boolean) => {
    setExpandedOverrides((current) => {
      const next = new Set(current ?? defaultExpandedPaths(fileTree));
      if (expanded) next.add(path);
      else next.delete(path);
      return next;
    });
  };

  const selectNode = (node: FileNode, e: React.MouseEvent<HTMLElement>) => {
    if (e.shiftKey) {
      const visible = flattenVisibleNodes(fileTree, expandedPaths);
      const anchorIndex = anchorPath ? visible.findIndex((n) => n.path === anchorPath) : -1;
      const currentIndex = visible.findIndex((n) => n.path === node.path);
      if (currentIndex >= 0 && anchorIndex >= 0) {
        const [start, end] = anchorIndex <= currentIndex ? [anchorIndex, currentIndex] : [currentIndex, anchorIndex];
        setSelectedPaths(new Set(visible.slice(start, end + 1).map((n) => n.path)));
      } else {
        setSelectedPaths(new Set([node.path]));
        setAnchorPath(node.path);
      }
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      setSelectedPaths((current) => {
        const next = new Set(current);
        if (next.has(node.path)) next.delete(node.path);
        else next.add(node.path);
        return next;
      });
      setAnchorPath(node.path);
      return;
    }

    setSelectedPaths(new Set([node.path]));
    setAnchorPath(node.path);
  };

  const beginTreeDrag = (e: React.DragEvent<HTMLElement>, node: FileNode) => {
    const isSelected = selectedPaths.has(node.path);
    const paths = isSelected ? [...selectedPaths] : [node.path];
    if (!isSelected) {
      setSelectedPaths(new Set([node.path]));
      setAnchorPath(node.path);
    }
    e.dataTransfer.setData(TREE_DRAG_MIME, JSON.stringify(paths));
    e.dataTransfer.effectAllowed = "move";
    e.stopPropagation();
  };

  const handleInternalDragOver = (e: React.DragEvent<HTMLElement>, path: string) => {
    if (!isInternalTreeDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDropTargetPath(path);
  };

  const handleInternalDragLeave = (e: React.DragEvent<HTMLElement>) => {
    if (!isInternalTreeDrag(e)) return;
    const related = e.relatedTarget instanceof Node ? e.relatedTarget : null;
    if (!related || !e.currentTarget.contains(related)) setDropTargetPath(null);
  };

  const handleInternalDrop = (e: React.DragEvent<HTMLElement>, destDir: string) => {
    if (!isInternalTreeDrag(e)) return;
    const paths = internalDragPaths(e);
    e.preventDefault();
    e.stopPropagation();
    setDropTargetPath(null);
    if (!paths?.length || !workspacePath) return;
    void moveEntries(workspacePath, destDir, paths)
      .then((moved) => {
        setSelectedPaths(new Set(moved));
        setAnchorPath(moved[0] ?? null);
      })
      .catch((err) => console.error("move selected files failed:", err));
  };

  const endTreeDrag = () => setDropTargetPath(null);

  // ⌘N (New File) targeting the workspace root.
  const rootCreate = pendingCreate && pendingCreate.parentPath === "" ? pendingCreate : null;
  const finishRootCreate = () => setPendingCreate(null);

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
    <div
      data-file-drop-path=""
      className={`min-h-full pb-4 ${dropTargetPath === "" ? "ring-1 ring-inset ring-accent" : ""}`}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={(e) => handleInternalDragOver(e, "")}
      onDragLeave={handleInternalDragLeave}
      onDrop={(e) => handleInternalDrop(e, "")}
    >
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
          <TreeNode
            key={node.path}
            node={node}
            depth={0}
            dropTargetPath={dropTargetPath}
            expandedPaths={expandedPaths}
            selectedPaths={selectedPaths}
            onSelectNode={selectNode}
            onSetFolderExpanded={setFolderExpanded}
            onBeginTreeDrag={beginTreeDrag}
            onInternalDragOver={handleInternalDragOver}
            onInternalDragLeave={handleInternalDragLeave}
            onInternalDrop={handleInternalDrop}
            onEndTreeDrag={endTreeDrag}
          />
        ))}
        {rootCreate && (
          <InlineInput
            depth={0}
            isDir={rootCreate.isDir}
            placeholder={rootCreate.isDir ? "folder name" : "file name"}
            onCancel={finishRootCreate}
            onSubmit={async (name) => {
              finishRootCreate();
              if (!workspacePath || !name.trim()) return;
              try {
                await createEntry(workspacePath, name, rootCreate.isDir);
                if (!rootCreate.isDir) openFile(name);
              } catch (err) {
                console.error("create failed:", err);
              }
            }}
          />
        )}
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

function TreeNode({
  node,
  depth,
  dropTargetPath,
  expandedPaths,
  selectedPaths,
  onSelectNode,
  onSetFolderExpanded,
  onBeginTreeDrag,
  onInternalDragOver,
  onInternalDragLeave,
  onInternalDrop,
  onEndTreeDrag,
}: {
  node: FileNode;
  depth: number;
  dropTargetPath: string | null;
  expandedPaths: Set<string>;
  selectedPaths: Set<string>;
  onSelectNode: (node: FileNode, e: React.MouseEvent<HTMLElement>) => void;
  onSetFolderExpanded: (path: string, expanded: boolean) => void;
  onBeginTreeDrag: (e: React.DragEvent<HTMLElement>, node: FileNode) => void;
  onInternalDragOver: (e: React.DragEvent<HTMLElement>, path: string) => void;
  onInternalDragLeave: (e: React.DragEvent<HTMLElement>) => void;
  onInternalDrop: (e: React.DragEvent<HTMLElement>, destDir: string) => void;
  onEndTreeDrag: () => void;
}) {
  const open = node.type === "folder" && expandedPaths.has(node.path);
  const { selectedFile, openFile, openPreview, workspacePath } = useUIStore();
  const { createEntry, renameEntry, deleteEntry, setSelectedTreeNode, copyNode, pasteNode, duplicateNode, setPendingRename, setPendingDelete } = useWorkspaceStore();
  const clipboard = useWorkspaceStore((s) => s.clipboard);
  const selectedTreeNode = useWorkspaceStore((s) => s.selectedTreeNode);
  const pendingRename = useWorkspaceStore((s) => s.pendingRename);
  const pendingDelete = useWorkspaceStore((s) => s.pendingDelete);
  const pendingCreate = useWorkspaceStore((s) => s.pendingCreate);
  const setPendingCreate = useWorkspaceStore((s) => s.setPendingCreate);
  const pad = { paddingLeft: `${depth * 12 + 12}px` };

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [inline, setInline] = useState<InlineEdit | null>(null);
  const [confirmDel, setConfirmDel] = useState<{ path: string; type: "file" | "folder" } | null>(null);

  const isClipboardNode = clipboard?.path === node.path;
  const isTreeSelected = selectedTreeNode?.path === node.path;
  const isSelected = selectedPaths.has(node.path);
  const isDropTarget = node.type === "folder" && dropTargetPath === node.path;
  const isInlineRenaming = inline?.mode === "rename" && inline.node?.path === node.path;

  // Keyboard shortcut: ⌘N → create inside this folder (expands it too)
  useEffect(() => {
    if (node.type === "folder" && pendingCreate?.parentPath === node.path) {
      setInline({ mode: "create", parentPath: node.path, isDir: pendingCreate.isDir });
      onSetFolderExpanded(node.path, true);
      setPendingCreate(null);
    }
  }, [pendingCreate, node.path, node.type, setPendingCreate, onSetFolderExpanded]);

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
    if (node.type === "folder") onSetFolderExpanded(node.path, true);
  };

  const menuItems: ContextMenuItem[] = menu
    ? [
        // Doc preview (svg/md/html) — left-click still opens the source in
        // Monaco; this is opt-in per file via right-click.
        ...(menu.node.type === "file" && isPreviewablePath(menu.node.path)
          ? [
              {
                id: "open-preview",
                label: "Open Preview",
                icon: Eye,
                onClick: () => openPreview(menu.node.path),
              } satisfies ContextMenuItem,
            ]
          : []),
        { id: "new-file", label: "New File", icon: FilePlus, onClick: () => startCreate(false) },
        { id: "new-folder", label: "New Folder", icon: FolderPlus, onClick: () => startCreate(true) },
        { id: "copy", label: "Copy", icon: Copy, onClick: () => { copyNode(node.path, node.type); setSelectedTreeNode({ path: node.path, type: node.type }); } },
        {
          id: "copy-reference",
          label: "Copy Reference",
          icon: Link,
          onClick: () => {
            void writeClipboardText(menu.node.path);
          },
        },
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

  const handleSelect = (e: React.MouseEvent<HTMLElement>) => {
    onSelectNode(node, e);
    setSelectedTreeNode({ path: node.path, type: node.type });
  };

  const handleClickSelectOnly = (e: React.MouseEvent<HTMLElement>) =>
    e.shiftKey || e.ctrlKey || e.metaKey;

  if (node.type === "folder") {
    return (
      <>
        <button
          data-file-drop-path={node.path}
          draggable={!isInlineRenaming}
          onClick={(e) => {
            handleSelect(e);
            if (!handleClickSelectOnly(e)) onSetFolderExpanded(node.path, !open);
          }}
          onDragStart={(e) => onBeginTreeDrag(e, node)}
          onDragEnd={onEndTreeDrag}
          onDragOver={(e) => onInternalDragOver(e, node.path)}
          onDragLeave={onInternalDragLeave}
          onDrop={(e) => onInternalDrop(e, node.path)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleSelect(e);
            setMenu({ x: e.clientX, y: e.clientY, node });
          }}
          style={pad}
          className={`flex w-full items-center gap-1.5 py-0.5 pr-2 text-[12.5px] hover:bg-hover hover:text-fg ${
            isDropTarget ? "bg-active text-fg ring-1 ring-inset ring-accent" : isSelected || isTreeSelected ? "bg-active text-fg" : "text-fg-muted"
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
        {inline && inline.mode === "rename" && inline.node?.path === node.path && (
          <InlineInput
            depth={depth}
            isDir
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
        {open && (
          <>
            {node.children?.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                dropTargetPath={dropTargetPath}
                expandedPaths={expandedPaths}
                selectedPaths={selectedPaths}
                onSelectNode={onSelectNode}
                onSetFolderExpanded={onSetFolderExpanded}
                onBeginTreeDrag={onBeginTreeDrag}
                onInternalDragOver={onInternalDragOver}
                onInternalDragLeave={onInternalDragLeave}
                onInternalDrop={onInternalDrop}
                onEndTreeDrag={onEndTreeDrag}
              />
            ))}
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
                    if (!inline.isDir) openFile(fullPath);
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
        draggable={!isInlineRenaming}
        onClick={(e) => {
          handleSelect(e);
          if (!handleClickSelectOnly(e)) openFile(node.path);
        }}
        onDragStart={(e) => onBeginTreeDrag(e, node)}
        onDragEnd={onEndTreeDrag}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleSelect(e);
          setMenu({ x: e.clientX, y: e.clientY, node });
        }}
        style={pad}
        className={`group flex w-full items-center gap-1.5 py-0.5 pl-6 pr-2 text-[12.5px] ${
          selected ? "bg-active text-fg" : isSelected ? "bg-active text-fg" : isTreeSelected ? "bg-hover text-fg" : "text-fg-muted hover:bg-hover hover:text-fg"
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
