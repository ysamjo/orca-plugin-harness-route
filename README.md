# Orca-Plugin: Harness Route

Komfortbefehle, automatischer Start bei neuen Worktrees und Modell-Fallback mit Kontext-Komprimierung.

## Befehle & Shortcuts

- **Harness: Route im Terminal starten (Prio 1)** (`Cmd+Alt+R`):
  Wählt die erste verfügbare Route aus `~/.harness-dispatch/config.yaml` und startet sie im ersten Terminal des aktiven Worktrees.
- **Harness: Nächstes Modell starten (Fallback / Handoff)** (`Cmd+Alt+N`):
  Komprimiert den Kontext (`/compact`) und wechselt im selben Terminal auf das nächste aktive Modell aus der Kette.
- **Harness: AGENTS.md spiegeln** (Palette & Event):
  Schreibt `~/Developer/AGENTS.md` plus `~/.harness-dispatch/AGENTS.md` in die nativen Global-Dateien (`~/.codex/AGENTS.md`, `~/.config/opencode/AGENTS.md`, `~/.claude/CLAUDE.md`). Läuft auch automatisch bei jedem `worktree.created`.

## Automatischer Start bei neuen Worktrees

Sobald ein neuer Task/Worktree in Orca angelegt wird (`worktree.created`), wartet das Plugin kurz auf die Terminal-Initialisierung und startet automatisch den Prio-1-Agenten aus `config.yaml`.

## Was es tut

1. Kette aus `~/.harness-dispatch/config.yaml` lesen (Reihenfolge, `enabled !== false`).
2. Per `command -v` die erste verfügbare Route wählen.
3. Startbefehl bauen: Liest Orcas aktuelle `agentDefaultArgs` direkt aus `profile-state.db` (mit Fallback auf `orca-data.json`) plus Modell aus der Kette.
4. Per `terminal.sendText` ins Terminal tippen (mit Enter).

## Installation

1. Dev-Plugin-Pfad ist in Orcas `devPluginPaths` eingetragen (`/Users/family/orca/workspaces/harness-router-gui/cisco/orca-plugin-harness-route`).
2. Einstellungen → Plugins → „Harness Route" zustimmen und aktivieren.
3. Im Workspace einen leeren Terminal-Tab öffnen und **Cmd+Alt+R** drücken (oder einfach neuen Worktree erstellen).
4. Bei Bedarf mit **Cmd+Alt+N** auf das nächste Modell wechseln.

## Prüfung

```bash
node --test test/route.test.mjs
```
