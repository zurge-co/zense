export interface FileNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
  /** True when excluded by a workspace .gitignore — rendered dimmed. */
  ignored?: boolean;
}

export const fileTree: FileNode[] = [
  {
    name: "src",
    path: "src",
    type: "folder",
    children: [
      {
        name: "auth",
        path: "src/auth",
        type: "folder",
        children: [
          { name: "login.ts", path: "src/auth/login.ts", type: "file" },
          { name: "token.rs", path: "src/auth/token.rs", type: "file" },
          { name: "session.ts", path: "src/auth/session.ts", type: "file" },
        ],
      },
      {
        name: "middleware",
        path: "src/middleware",
        type: "folder",
        children: [
          { name: "auth.ts", path: "src/middleware/auth.ts", type: "file" },
          { name: "logging.ts", path: "src/middleware/logging.ts", type: "file" },
        ],
      },
      {
        name: "graph",
        path: "src/graph",
        type: "folder",
        children: [
          { name: "builder.rs", path: "src/graph/builder.rs", type: "file" },
          { name: "parser.ts", path: "src/graph/parser.ts", type: "file" },
        ],
      },
      { name: "main.ts", path: "src/main.ts", type: "file" },
      { name: "lib.rs", path: "src/lib.rs", type: "file" },
    ],
  },
  {
    name: "docs",
    path: "docs",
    type: "folder",
    children: [
      { name: "architecture.md", path: "docs/architecture.md", type: "file" },
      { name: "api.md", path: "docs/api.md", type: "file" },
    ],
  },
  { name: "Cargo.toml", path: "Cargo.toml", type: "file" },
  { name: "package.json", path: "package.json", type: "file" },
  { name: "README.md", path: "README.md", type: "file" },
];

export interface MockFile {
  language: string;
  content: string;
}

export const mockFiles: Record<string, MockFile> = {
  "src/auth/login.ts": {
    language: "typescript",
    content: `import { verifyCredentials } from "./session";
import { issueToken } from "./token";

export interface LoginRequest {
  email: string;
  password: string;
}

export async function login(req: LoginRequest) {
  const user = await verifyCredentials(req.email, req.password);
  if (!user) {
    throw new AuthError("invalid_credentials");
  }

  const token = issueToken({ sub: user.id, role: user.role });
  await auditLog.record("login.success", user.id);

  return { token, user };
}

export class AuthError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
`,
  },
  "src/auth/token.rs": {
    language: "rust",
    content: `use jsonwebtoken::{encode, decode, Header, Validation, EncodingKey, DecodingKey};
use serde::{Serialize, Deserialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub role: String,
    pub exp: usize,
}

pub fn issue_token(claims: &Claims, secret: &str) -> Result<String, TokenError> {
    encode(
        &Header::default(),
        claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(TokenError::Issue)
}

pub fn verify_token(token: &str, secret: &str) -> Result<Claims, TokenError> {
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )?;
    Ok(data.claims)
}
`,
  },
  "src/auth/session.ts": {
    language: "typescript",
    content: `import { db } from "../db";
import { compare } from "bcrypt";

export async function verifyCredentials(email: string, password: string) {
  const user = await db.users.findByEmail(email);
  if (!user) return null;

  const ok = await compare(password, user.passwordHash);
  return ok ? user : null;
}

export async function createSession(userId: string) {
  return db.sessions.insert({ userId, createdAt: new Date() });
}
`,
  },
  "src/middleware/auth.ts": {
    language: "typescript",
    content: `import { verifyToken } from "../auth/token";

export async function authMiddleware(req: Request, next: Next) {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return Response.json({ error: "missing_token" }, { status: 401 });
  }

  try {
    const claims = verifyToken(header.slice(7));
    req.context.user = claims;
    return next(req);
  } catch {
    return Response.json({ error: "invalid_token" }, { status: 401 });
  }
}
`,
  },
  "src/main.ts": {
    language: "typescript",
    content: `import { createServer } from "./server";
import { authMiddleware } from "./middleware/auth";

const app = createServer();

app.use("/api/*", authMiddleware);

app.listen(3000, () => {
  console.log("listening on :3000");
});
`,
  },
};

export const fallbackFile: MockFile = {
  language: "plaintext",
  content: `// Preview not available yet.\n// Zense will load this file once the file system layer is wired up.`,
};

/** HEAD (committed) versions of files with working-tree changes. */
export const headFiles: Record<string, string> = {
  "src/auth/login.ts": `import { verifyCredentials } from "./session";
import { issueToken } from "./token";

export interface LoginRequest {
  email: string;
  password: string;
}

export async function login(req: LoginRequest) {
  const user = await verifyCredentials(req.email, req.password);
  if (!user) {
    throw new AuthError("invalid_credentials");
  }

  const token = issueToken({ sub: user.id, role: user.role });

  return { token, user };
}

export class AuthError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
`,
  "src/middleware/auth.ts": `import { verifyToken } from "../auth/token";

export async function authMiddleware(req: Request, next: Next) {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return Response.json({ error: "missing_token" }, { status: 401 });
  }

  const claims = verifyToken(header.slice(7));
  req.context.user = claims;
  return next(req);
}
`,
  // Deleted file — exists only in HEAD.
  "src/auth/legacy.ts": `// Legacy password auth — superseded by token.rs
export function legacyLogin(email: string, password: string) {
  const user = db.query("SELECT * FROM users WHERE email = ?", email);
  if (!user || user.password !== password) return null;
  return user;
}
`,
  // Added file — empty in HEAD.
  "src/auth/refresh.ts": "",
};

/** Working-tree versions of changed files not already in mockFiles. */
export const extraWorkingFiles: Record<string, MockFile> = {
  "src/auth/refresh.ts": {
    language: "typescript",
    content: `import { issueToken, verifyToken } from "./token";

export async function refresh(refreshToken: string) {
  const claims = verifyToken(refreshToken);
  if (claims.type !== "refresh") {
    throw new AuthError("invalid_refresh_token");
  }
  return { token: issueToken({ sub: claims.sub, role: claims.role }) };
}
`,
  },
};

export const diffStats: Record<string, { adds: number; dels: number }> = {
  "src/auth/login.ts": { adds: 1, dels: 0 },
  "src/middleware/auth.ts": { adds: 4, dels: 3 },
  "src/auth/refresh.ts": { adds: 9, dels: 0 },
  "src/auth/legacy.ts": { adds: 0, dels: 7 },
};

export interface SymbolItem {
  name: string;
  kind: "function" | "class" | "interface" | "variable";
  line: number;
}

export const outlineSymbols: Record<string, SymbolItem[]> = {
  "src/auth/login.ts": [
    { name: "LoginRequest", kind: "interface", line: 4 },
    { name: "login", kind: "function", line: 9 },
    { name: "AuthError", kind: "class", line: 22 },
  ],
  "src/auth/token.rs": [
    { name: "Claims", kind: "class", line: 4 },
    { name: "issue_token", kind: "function", line: 11 },
    { name: "verify_token", kind: "function", line: 20 },
  ],
};

export const gitChanges = [
  { status: "M", file: "src/auth/login.ts" },
  { status: "M", file: "src/middleware/auth.ts" },
  { status: "A", file: "src/auth/refresh.ts" },
  { status: "D", file: "src/auth/legacy.ts" },
];

export const searchResults = [
  {
    file: "src/auth/login.ts",
    matches: [
      { line: 9, text: "export async function login(req: LoginRequest) {" },
      { line: 17, text: 'await auditLog.record("login.success", user.id);' },
    ],
  },
  {
    file: "src/middleware/auth.ts",
    matches: [{ line: 3, text: "export async function authMiddleware(req: Request, next: Next) {" }],
  },
  {
    file: "src/main.ts",
    matches: [{ line: 6, text: 'app.use("/api/*", authMiddleware);' }],
  },
];

export const promptLibrary = [
  { name: "Explain", description: "Explain what this code does, step by step.", icon: "BookOpen" },
  { name: "Review", description: "Review this code for bugs and style issues.", icon: "Eye" },
  { name: "Refactor", description: "Suggest a cleaner structure for this code.", icon: "Wand2" },
  { name: "Generate tests", description: "Write unit tests for the selected code.", icon: "FlaskConical" },
  { name: "Security review", description: "Look for vulnerabilities and unsafe patterns.", icon: "ShieldCheck" },
  { name: "Performance review", description: "Find hot paths and wasteful work.", icon: "Gauge" },
];

export const shortcutGroups: { title: string; items: { keys: string; action: string }[] }[] = [
  {
    title: "Panels",
    items: [
      { keys: "⌘B", action: "Toggle sidebar" },
      { keys: "⌘J", action: "Toggle terminal" },
      { keys: "⌘⇧C", action: "Toggle AI chat" },
      { keys: "⌘+", action: "Zoom UI in" },
      { keys: "⌘−", action: "Zoom UI out" },
      { keys: "⌘0", action: "Reset UI zoom to 100%" },
    ],
  },
  {
    title: "Editor",
    items: [
      { keys: "⌘L", action: "Add selected lines to agent" },
      { keys: "right-click", action: "Add Selection to Agent (menu)" },
    ],
  },
  {
    title: "Composer",
    items: [
      { keys: "@", action: "Attach file" },
      { keys: "↑ ↓ Tab", action: "Navigate & pick mention" },
      { keys: "Esc", action: "Cancel mention" },
      { keys: "Enter", action: "Send to agent" },
      { keys: "⇧Enter", action: "New line" },
    ],
  },
  {
    title: "Terminal",
    items: [
      { keys: "⌘`", action: "New terminal" },
      { keys: "⌘W", action: "Close active terminal tab" },
      { keys: "double-click tab", action: "Rename terminal" },
    ],
  },
  {
    title: "General",
    items: [
      { keys: "⌘N", action: "New window" },
      { keys: "⌘O", action: "Open folder" },
      { keys: "⌘S", action: "Save file" },
      { keys: "⌘,", action: "Open settings" },
      { keys: "Esc", action: "Close modal / popup" },
    ],
  },
];

export const recentWorkspaces = [
  { name: "api-gateway", path: "~/dev/acme/api-gateway", lastOpened: "2 hours ago" },
  { name: "zense", path: "~/Workspace/zurge/zense", lastOpened: "yesterday" },
  { name: "docs-site", path: "~/dev/acme/docs-site", lastOpened: "3 days ago" },
  { name: "mobile-app", path: "~/dev/acme/mobile-app", lastOpened: "last week" },
];

/** Flat list of all files (for @-mention autocomplete in the composer). */
export const allFiles: string[] = (function flatten(nodes: FileNode[]): string[] {
  return nodes.flatMap((n) =>
    n.type === "file" ? [n.path] : flatten(n.children ?? []),
  );
})(fileTree);

/** Extract a snippet of real code for a chip's line range (mock of the context engine). */
export function getSnippet(path: string, start: number, end: number): string {
  const file = mockFiles[path] ?? extraWorkingFiles[path];
  if (!file) return "";
  return file.content
    .split("\n")
    .slice(start - 1, end)
    .join("\n");
}

export const graphTypes = ["Function calls", "Module dependency", "Package dependency", "Reference graph"];

export interface GraphNode {
  id: string;
  label: string;
  file: string;
  line: number;
  x: number;
  y: number;
  color: string;
}

export const graphNodes: GraphNode[] = [
  { id: "main", label: "main()", file: "src/main.ts", line: 3, x: 400, y: 40, color: "#3fb950" },
  { id: "server", label: "createServer()", file: "src/main.ts", line: 3, x: 400, y: 130, color: "#4f8cff" },
  { id: "authmw", label: "authMiddleware()", file: "src/middleware/auth.ts", line: 3, x: 240, y: 230, color: "#bc8cff" },
  { id: "router", label: "router.use()", file: "src/main.ts", line: 6, x: 560, y: 230, color: "#4f8cff" },
  { id: "login", label: "login()", file: "src/auth/login.ts", line: 9, x: 150, y: 330, color: "#bc8cff" },
  { id: "verify", label: "verifyToken()", file: "src/auth/token.rs", line: 20, x: 340, y: 330, color: "#bc8cff" },
  { id: "creds", label: "verifyCredentials()", file: "src/auth/session.ts", line: 4, x: 60, y: 430, color: "#d29922" },
  { id: "issue", label: "issue_token()", file: "src/auth/token.rs", line: 11, x: 240, y: 430, color: "#d29922" },
  { id: "db", label: "db.users", file: "src/db.ts", line: 1, x: 120, y: 520, color: "#5d6b82" },
  { id: "jwt", label: "jsonwebtoken", file: "Cargo.toml", line: 12, x: 320, y: 520, color: "#5d6b82" },
];

export const graphEdges: [string, string][] = [
  ["main", "server"],
  ["server", "authmw"],
  ["server", "router"],
  ["authmw", "login"],
  ["authmw", "verify"],
  ["login", "creds"],
  ["login", "issue"],
  ["creds", "db"],
  ["issue", "jwt"],
  ["verify", "jwt"],
];
