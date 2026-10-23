// Startet die erste verfuegbare Route aus ~/.harness-dispatch/config.yaml
// im ersten Terminal des aktiven Worktrees (ein Tastendruck: Cmd+Alt+R)
// oder per Event automatisch beim Erstellen eines neuen Worktrees.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const KETTEN_PFAD = join(homedir(), '.harness-dispatch', 'config.yaml');
export const ORCA_DB_PFAD = join(homedir(), 'Library', 'Application Support', 'Orca', 'profiles', 'local-default', 'profile-state.db');
export const ORCA_DATEN_PFAD = join(homedir(), 'Library', 'Application Support', 'Orca', 'profiles', 'local-default', 'orca-data.json');

// Startbefehl je Harness (TUI-Modus, wie Orcas Agent-Start).
export const STARTBEFEHL = {
  cline: 'cline',
  opencode: 'opencode',
  claude: 'claude',
  codebuddy: 'codebuddy',
  qoder: 'qodercli',
  antigravity: 'agy',
  cursor: 'cursor-agent',
  codex: 'codex',
  freebuff: 'freebuff',
  grok: 'grok',
  kiro: 'kiro-cli',
  kilo: 'kilo'
};

// Nur qoder nimmt -m, alle anderen --model. Freebuff kennt kein Modell-Flag.
const MODELL_SCHALTER = { qoder: '-m' };

// Rueckfall, falls Orcas agentDefaultArgs nicht lesbar sind (Orcas Yolo-Standard).
export const RUECKFALL_ARGS = {
  cline: '--auto-approve true',
  opencode: '',
  claude: '--dangerously-skip-permissions',
  codebuddy: '--dangerously-skip-permissions',
  qoder: '--dangerously-skip-permissions',
  antigravity: '--dangerously-skip-permissions',
  cursor: '--yolo',
  codex: '--dangerously-bypass-approvals-and-sandbox',
  freebuff: '',
  grok: '--permission-mode bypassPermissions',
  kiro: '--trust-all-tools'
};

const SICHERES_WORT = /^[A-Za-z0-9@._/:+=-]+$/;

// Liest die Routen in Kettenreihenfolge. Aktiv ist alles ohne enabled: false.
// Unbekannte Harness-IDs fallen raus.
export function parseKette(text) {
  const routen = [];
  let aktuell = null;
  for (const zeile of text.split(/\r?\n/)) {
    const name = zeile.match(/^\s*-\s*name:\s*(.+?)\s*$/);
    if (name) {
      aktuell = { name: name[1] };
      routen.push(aktuell);
      continue;
    }
    if (!aktuell) continue;
    const feld = zeile.match(/^\s{2,}(harnessId|model|enabled):\s*(.+?)\s*$/);
    if (feld) {
      const wert = feld[2];
      aktuell[feld[1]] = wert === 'true' ? true : wert === 'false' ? false : wert;
    }
  }
  return routen.filter((route) => route.harnessId && STARTBEFEHL[route.harnessId] && route.enabled !== false);
}

// Baut den TUI-Startbefehl. Modell aus der Kette, ausser es steht schon in den Args.
export function baueBefehl(route, args) {
  const basis = (args ?? '').trim();
  let befehl = STARTBEFEHL[route.harnessId];
  if (basis) befehl += ` ${basis}`;
  const hatModell = /(^|\s)(-m|--model)(\s|=|$)/.test(` ${basis} `);
  if (route.harnessId !== 'freebuff' && route.model && !hatModell) {
    if (!SICHERES_WORT.test(route.model)) throw new Error(`Unsicheres Modell: ${route.model}`);
    befehl += ` ${MODELL_SCHALTER[route.harnessId] ?? '--model'} ${route.model}`;
  }
  if (/[\n;`$()|&<>]/.test(befehl)) throw new Error('Unsicherer Startbefehl');
  return befehl;
}

// Ermittelt die Folgeroute in der Kette (zyklischer Fallback)
export function findeNaechsteRoute(aktuelleId, kette) {
  if (!kette || kette.length === 0) return null;
  if (!aktuelleId) return kette[0];
  const index = kette.findIndex((r) => r.harnessId === aktuelleId || r.name === aktuelleId);
  if (index === -1) return kette[0];
  return kette[(index + 1) % kette.length];
}

function pruefeBin(befehl, umgebung) {
  return new Promise((resolve) => {
    execFile('sh', ['-c', `command -v ${befehl}`], { env: umgebung, timeout: 3000 }, (fehler) => resolve(!fehler));
  });
}

// Orcas agentDefaultArgs: zuerst aus profile-state.db lesen, Rueckfall auf orca-data.json
export async function liesOrcaArgs(harnessId, dbPfad = ORCA_DB_PFAD, jsonPfad = ORCA_DATEN_PFAD) {
  // 1. Live aus SQLite (Orca 1.4+ Speicherort)
  try {
    const stdout = await new Promise((resolve, reject) => {
      execFile('sqlite3', ['-readonly', dbPfad, "SELECT payload FROM profile_state_documents WHERE domain='settings';"], { timeout: 2500 }, (err, out) => {
        if (err) return reject(err);
        resolve(out);
      });
    });
    if (stdout?.trim()) {
      const settings = JSON.parse(stdout);
      const args = settings?.agentDefaultArgs?.[harnessId];
      if (typeof args === 'string') return args;
    }
  } catch {
    // Fallback auf orca-data.json
  }

  // 2. Rueckfall auf orca-data.json
  try {
    const daten = JSON.parse(await readFile(jsonPfad, 'utf8'));
    const args = daten?.settings?.agentDefaultArgs?.[harnessId];
    return typeof args === 'string' ? args : null;
  } catch {
    return null;
  }
}

export async function ermittleStartBefehl(route) {
  const args = (await liesOrcaArgs(route.harnessId)) ?? RUECKFALL_ARGS[route.harnessId] ?? '';
  return baueBefehl(route, args);
}

export async function starteRouteImTerminal(orca, route, options = {}) {
  const befehl = await ermittleStartBefehl(route);
  const maxVersuche = options.maxVersuche ?? 1;
  const warteMs = options.warteMs ?? 300;
  let terminalId = null;

  for (let i = 0; i < maxVersuche; i++) {
    const kontext = await orca.host.call('workspace.readContext');
    terminalId = kontext?.terminals?.[0]?.id;
    if (terminalId) break;
    if (i < maxVersuche - 1) {
      await new Promise((r) => setTimeout(r, warteMs));
    }
  }

  if (!terminalId) throw new Error('Kein Terminal im aktiven Worktree — erst einen Terminal-Tab oeffnen');
  const ergebnis = await orca.host.call('terminal.sendText', { terminalId, text: befehl, enter: true });
  orca.log(`Route ${route.name} (${route.harnessId}) gestartet: ${befehl}`);
  return { route: route.name, befehl, terminalId, angenommen: ergebnis?.accepted ?? null };
}

export async function starteErsteRoute(orca, options = {}) {
  const kette = parseKette(await readFile(KETTEN_PFAD, 'utf8'));
  if (kette.length === 0) throw new Error('Keine aktive Route in config.yaml');
  const umgebung = {
    ...process.env,
    PATH: `${join(homedir(), '.local', 'bin')}:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? '/usr/bin:/bin'}`
  };
  const treffer = await Promise.all(kette.map((route) => pruefeBin(STARTBEFEHL[route.harnessId], umgebung)));
  const route = kette[treffer.findIndex(Boolean)];
  if (!route) throw new Error('Keine Route verfuegbar (kein CLI auf PATH)');
  return starteRouteImTerminal(orca, route, options);
}

export async function wechsleAufNaechstesModell(orca, vorherigesHarnessId = null) {
  const kette = parseKette(await readFile(KETTEN_PFAD, 'utf8'));
  if (kette.length === 0) throw new Error('Keine aktive Route in config.yaml');

  const naechsteRoute = findeNaechsteRoute(vorherigesHarnessId, kette);
  if (!naechsteRoute) throw new Error('Keine Folgeroute gefunden');

  const kontext = await orca.host.call('workspace.readContext');
  const terminalId = kontext?.terminals?.[0]?.id;
  if (!terminalId) throw new Error('Kein Terminal im aktiven Worktree');

  // Kontext komprimieren: /compact senden
  orca.log(`Fallback eingeleitet: sende /compact und wechsle zu ${naechsteRoute.name}...`);
  await orca.host.call('terminal.sendText', { terminalId, text: '/compact', enter: true });

  // Kurze Pause, damit der aktuelle Agent den Compact-Befehl verarbeiten kann
  await new Promise((r) => setTimeout(r, 4000));

  // Folgebefehl absenden
  const befehl = await ermittleStartBefehl(naechsteRoute);
  const ergebnis = await orca.host.call('terminal.sendText', { terminalId, text: befehl, enter: true });
  orca.log(`Folgemodell ${naechsteRoute.name} gestartet: ${befehl}`);
  return { route: naechsteRoute.name, befehl, angenommen: ergebnis?.accepted ?? null };
}

export default function activate(orca) {
  let letztesWorktreeStart = 0;

  orca.commands.register('route-launch', async () => {
    return starteErsteRoute(orca);
  });

  orca.commands.register('route-next', async () => {
    return wechsleAufNaechstesModell(orca);
  });

  orca.commands.register('agents-sync', () => spiegle(orca));

  orca.events.on('worktree.created', async (event) => {
    try {
      await spiegle(orca);
    } catch (fehler) {
      orca.log(`AGENTS.md-Spiegel uebersprungen: ${fehler.message}`);
    }

    // Auto-Start des Prio-1-Agenten im neuen Worktree
    const jetzt = Date.now();
    if (jetzt - letztesWorktreeStart < 3000) return;
    letztesWorktreeStart = jetzt;

    try {
      // 800ms warten, damit Orca das initiale Terminal im neuen Worktree anlegen kann
      await new Promise((r) => setTimeout(r, 800));
      await starteErsteRoute(orca, { maxVersuche: 6, warteMs: 500 });
      orca.log('Prio-1-Agent im neu angelegten Worktree automatisch gestartet.');
    } catch (fehler) {
      orca.log(`Automatischer Agent-Start nach worktree.created uebersprungen: ${fehler.message}`);
    }
  });
}

// Spiegelt Developer/AGENTS.md plus globale Datei in die nativen
// Global-Dateien der CLIs (Projekt-AGENTS.md lesen die CLIs selbst).
// Quellen wie im Harness-Router (rootDev, dann globaler Rueckfall).
const ENTWICKLER_DATEI = join(homedir(), 'Developer', 'AGENTS.md');
const GLOBAL_DATEI = join(homedir(), '.harness-dispatch', 'AGENTS.md');
const SPIEGEL_ZIELE = [
  join(homedir(), '.codex', 'AGENTS.md'),
  join(homedir(), '.config', 'opencode', 'AGENTS.md'),
  join(homedir(), '.claude', 'CLAUDE.md')
];

// Reine Funktion fuer Tests: baut den Spiegeltext aus den Quelltexten.
export function baueSpiegel(entwickler, global) {
  const teile = [
    '<!-- harness-route-spiegel: nicht von Hand aendern, Quellen: ~/Developer/AGENTS.md + ~/.harness-dispatch/AGENTS.md -->',
    ''
  ];
  if (entwickler?.trim()) teile.push(`[Spiegel aus ~/Developer/AGENTS.md]\n${entwickler.trim()}`, '');
  if (global?.trim()) teile.push(`[Spiegel aus ~/.harness-dispatch/AGENTS.md]\n${global.trim()}`, '');
  return teile.join('\n');
}

async function liesDatei(pfad) {
  try {
    return await readFile(pfad, 'utf8');
  } catch {
    return null;
  }
}

// Schreibt nur bei Aenderung (Hash im Plugin-Speicher).
export async function spiegle(orca, ziele = SPIEGEL_ZIELE) {
  const text = baueSpiegel(await liesDatei(ENTWICKLER_DATEI), await liesDatei(GLOBAL_DATEI));
  if (!text.trim()) throw new Error('Keine Spiegelquelle gefunden');
  const geschrieben = [];
  for (const ziel of ziele) {
    const schluessel = `spiegel:${ziel}`;
    const stand = await orca.host.call('storage.get', { key: schluessel });
    const prParts = createHash('sha256').update(text).digest('hex');
    if (stand?.value === prParts) continue;
    await mkdir(dirname(ziel), { recursive: true });
    await writeFile(ziel, text, 'utf8');
    await orca.host.call('storage.set', { key: schluessel, value: prParts });
    geschrieben.push(ziel);
  }
  orca.log(`AGENTS.md-Spiegel: ${geschrieben.length} Datei(en) aktualisiert`);
  return { geschrieben, uebersprungen: ziele.length - geschrieben.length };
}
