# Zense

> AI workspace for understanding codebases.

---

# Vision

Modern AI coding tools focus on generating code.

Zense focuses on **understanding** code.

It helps developers explore unfamiliar projects, trace execution flow, inspect architecture, understand business logic, and interact with their codebase through AI before making changes.

The goal is to reduce the time required to understand large repositories from hours to minutes.

---

# Core Principles

- AI-first
- Local-first
- Fast
- Native
- Privacy by default
- Developer focused

---

# Target Users

- Software engineers
- New team members
- Open source contributors
- Technical leads
- Solution architects
- AI-assisted developers

---

# Tech Stack

- Rust
- Tauri
- React
- Monaco Editor
- Tree-sitter
- Tokio
- Git2
- PTY Terminal

---

# Core Features

## AI Chat

Chat with the repository.

Examples

- Explain this function
- Where is this API called?
- Show me authentication flow
- Summarize this module
- Why does this error happen?
- Compare these commits

---

## Workspace

- Multiple workspaces
- Project history
- Session restore
- Window layout
- Split panels

---

## Editor

- Monaco
- Tabs
- Split editor
- Symbol outline
- Diagnostics
- AI inline explanation

---

## File Explorer

- Tree view
- Search
- Favorites
- Ignore patterns
- Recent files

---

## Integrated Terminal

- Multiple terminals
- Shell profiles
- Bash
- Zsh
- PowerShell
- Fish
- Custom profiles

---

## Git

- Status
- Diff viewer
- Blame
- Commit
- Branch switch
- AI commit summary

---

## AI Context Engine

Automatically gathers relevant context.

Includes

- Imports
- Dependencies
- Related files
- Call hierarchy
- Git history
- Symbols
- Open editors

---

## Code Graph

Visualize

- Function calls
- Module dependency
- Package dependency
- Reference graph

---

## Search

Unified search

- Files
- Symbols
- Text
- AI search

---

## Prompt Library

Reusable prompts

Examples

- Explain
- Review
- Refactor
- Generate tests
- Security review
- Performance review

---

## AI Providers

Supports

- OpenAI
- Anthropic
- Gemini
- OpenRouter
- Ollama
- LM Studio
- Zorch

Bring Your Own Key supported.

---

# Future Features

## MCP

Native Model Context Protocol support.

- Connect tools
- Connect databases
- Connect documentation
- Connect APIs

---

## Multi Agent

Specialized agents

- Reviewer
- Debugger
- Architect
- Security
- Documentation

---

## Timeline

Understand project evolution through Git history.

---

## Architecture View

Generate architecture diagrams automatically.

---

## Documentation Generator

Generate

- README
- API docs
- Sequence diagrams
- ADRs

---

## Workspace Memory

Remember

- Recent chats
- Open files
- AI context
- Notes

---

# Design Goals

- Minimal UI
- Keyboard first
- Extremely fast
- Native performance
- Zero unnecessary clicks

---

# CLI

```bash
zense .
zense my-project
zense --profile backend
zense --chat
zense --terminal
```

---

# Plugin System

Future extension system.

Plugins may add

- Languages
- AI providers
- Terminal tools
- Git integrations
- Themes
- Custom panels

---

# Philosophy

AI should not replace developers.

AI should make developers understand software faster.

Generate less.

Understand more.