/** Map a file path to a Monaco language id (falls back to plaintext). */

const BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  md: "markdown",
  mdx: "markdown",
  rs: "rust",
  py: "python",
  go: "go",
  rb: "ruby",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "cpp",
  h: "cpp",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  vue: "html",
  svelte: "html",
  xml: "xml",
  svg: "xml",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "ini",
  env: "ini",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  sql: "sql",
  graphql: "graphql",
  proto: "protobuf",
  lua: "lua",
  r: "r",
  php: "php",
  dart: "dart",
  ex: "elixir",
  exs: "elixir",
  tf: "hcl",
  hcl: "hcl",
  dockerfile: "dockerfile",
};

const BY_FILENAME: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "plaintext",
  ".gitignore": "shell",
  ".env": "ini",
};

export function detectLanguage(path: string): string {
  const name = path.split("/").pop() ?? path;
  const lower = name.toLowerCase();
  if (BY_FILENAME[lower]) return BY_FILENAME[lower];
  const ext = lower.includes(".") ? lower.split(".").pop()! : "";
  return BY_EXTENSION[ext] ?? "plaintext";
}
