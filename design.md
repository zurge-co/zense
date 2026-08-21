# Zense — Design System

## Brand Colors

| Token | Hex | Usage |
|---|---|---|
| `--color-accent` | `#00c55a` | Primary brand green — buttons, active states, focus rings |
| `--color-accent-lime` | `#6cdd25` | Gradient midpoint, diff additions |
| `--color-accent-gold` | `#facd04` | Gradient endpoint, warnings, highlights |

### Logo Gradient

The Zense logo uses a three-stop linear gradient:

```
#00c55a → #6cdd25 → #facd04
```

Applied to the main diagonal stroke of the Z mark.

## Surface Colors

| Token | Hex | Usage |
|---|---|---|
| `--color-base` | `#0d0d0d` | App background (darkest) |
| `--color-panel` | `#1a1a1a` | Panels, sidebars, title bar, modals |

## Text Colors

| Token | Hex | Usage |
|---|---|---|
| `--color-fg` | `#e8e8e8` | Primary text |
| `--color-fg-muted` | `#888888` | Secondary text, labels, hints |

## Structural Colors

| Token | Value | Usage |
|---|---|---|
| `--color-border` | `rgba(255,255,255,0.06)` | Borders, dividers |
| `--color-hover` | `rgba(255,255,255,0.04)` | Hover backgrounds |
| `--color-active` | `rgba(255,255,255,0.06)` | Active/pressed backgrounds |

## Status Colors

| Token | Hex | Usage |
|---|---|---|
| `--color-green` | `#6cdd25` | Diff additions, success |
| `--color-yellow` | `#facd04` | Warnings, diff modifications |
| `--color-danger` | `#f85149` | Errors, diff deletions, destructive actions |

## Typography

| Token | Stack | Usage |
|---|---|---|
| `--font-ui` | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif` | All UI text |
| `--font-mono` | `ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace` | Code, paths, monospace labels |

Base font size: `13px`

## Logo Assets

| File | Variant | Background | Usage |
|---|---|---|---|
| `assets/logo_zense-white.svg` | White (transparent) | Transparent | UI elements, favicon |
| `assets/logo_zense-black.svg` | Black | `#1a1a1a` | App icons (Tauri, iOS, Android) |
| `public/zense-logo.svg` | White (transparent) | Transparent | In-app `<img>` references |
| `public/favicon.svg` | White (transparent) | Transparent | Browser tab favicon |
