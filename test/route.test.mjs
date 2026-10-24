import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { baueBefehl, baueSpiegel, findeNaechsteRoute, liesOrcaArgs, parseKette, spiegle, starteRouteImSplit, starteErsteRouteImSplit } from '../main.mjs';

const KETTE = `clis:
  - name: codex_cli
    harnessId: codex
    enabled: false
  - name: cline_cli
    harnessId: cline
    model: cline-free/muse-spark-1.3-contributor
  - name: opencode_cli
    harnessId: opencode
    model: opencode/ling-3.1-flash-free
  - name: unbekannt_cli
    harnessId: gibt_es_nicht
  - name: qoder_cli
    harnessId: qoder
    model: Qwen3.8-Flash
    enabled: true
  - name: ohne_modell
    harnessId: claude
`;

test('Kette: Reihenfolge, enabled:false und Unbekannte raus', () => {
  const ids = parseKette(KETTE).map((route) => route.harnessId);
  assert.deepEqual(ids, ['cline', 'opencode', 'qoder', 'claude']);
});

test('Kette: Naechste Route finden (Fallback/Handoff Zyklus)', () => {
  const kette = parseKette(KETTE);
  assert.equal(findeNaechsteRoute(null, kette)?.harnessId, 'cline');
  assert.equal(findeNaechsteRoute('cline', kette)?.harnessId, 'opencode');
  assert.equal(findeNaechsteRoute('opencode', kette)?.harnessId, 'qoder');
  assert.equal(findeNaechsteRoute('claude', kette)?.harnessId, 'cline');
});

test('Befehl: Modell wird angehaengt', () => {
  assert.equal(baueBefehl({ harnessId: 'cline', model: 'm1' }, '--auto-approve true'), 'cline --auto-approve true --model m1');
});

test('Befehl: qoder nimmt -m', () => {
  assert.equal(baueBefehl({ harnessId: 'qoder', model: 'Q3' }, '--yolo'), 'qodercli --yolo -m Q3');
});

test('Befehl: vorhandenes Modell bleibt', () => {
  assert.equal(baueBefehl({ harnessId: 'opencode', model: 'neu' }, '--model alt'), 'opencode --model alt');
});

test('Befehl: ohne Modell und freebuff ohne Flag', () => {
  assert.equal(baueBefehl({ harnessId: 'claude' }, '--yolo'), 'claude --yolo');
  assert.equal(baueBefehl({ harnessId: 'freebuff', model: 'x' }, ''), 'freebuff');
});

test('Befehl: grok und kiro ohne Modell (Standard)', () => {
  assert.equal(baueBefehl({ harnessId: 'grok' }, '--permission-mode bypassPermissions'), 'grok --permission-mode bypassPermissions');
  assert.equal(baueBefehl({ harnessId: 'kiro' }, '--trust-all-tools'), 'kiro-cli --trust-all-tools');
});

test('Befehl: unsicher wird abgewiesen', () => {
  assert.throws(() => baueBefehl({ harnessId: 'cline', model: 'm;rm' }, ''), /Unsicher/);
});

test('liesOrcaArgs liest aus SQLite oder JSON', async () => {
  const args = await liesOrcaArgs('codebuddy');
  assert.ok(args !== null);
  assert.match(args, /deepseek/i);
});

test('Spiegel: beide Quellen mit Markierung', () => {
  const text = baueSpiegel('DEV', 'GLOBAL');
  assert.match(text, /harness-route-spiegel/);
  assert.match(text, /\[Spiegel aus ~\/Developer\/AGENTS\.md\]\nDEV/);
  assert.match(text, /\[Spiegel aus ~\/\.harness-dispatch\/AGENTS\.md\]\nGLOBAL/);
});

test('Spiegel: fehlende Quelle faellt raus', () => {
  assert.doesNotMatch(baueSpiegel(null, 'G'), /\[Spiegel aus ~\/Developer/);
  assert.doesNotMatch(baueSpiegel('', ''), /\[Spiegel aus/);
});

test('Spiegel: schreibt nur bei Aenderung', async () => {
  const dir = await fs.mkdtemp(join(os.tmpdir(), 'spiegel-'));
  const ziel = join(dir, 'AGENTS.md');
  const speicher = new Map();
  const orca = {
    host: {
      call: async (methode, params) => {
        if (methode === 'storage.get') return { value: speicher.get(params.key) ?? null };
        if (methode === 'storage.set') speicher.set(params.key, params.value);
        return {};
      }
    },
    log: () => {}
  };
  // Liest die echten Quellen, schreibt aber nur ins Temp-Verzeichnis.
  const r1 = await spiegle(orca, [ziel]);
  assert.equal(r1.geschrieben.length, 1);
  const r2 = await spiegle(orca, [ziel]);
  assert.equal(r2.geschrieben.length, 0);
  assert.equal(r2.uebersprungen, 1);
});

test('Split-Funktionen sind exportiert und aufrufbar', () => {
  assert.equal(typeof starteRouteImSplit, 'function');
  assert.equal(typeof starteErsteRouteImSplit, 'function');
});
