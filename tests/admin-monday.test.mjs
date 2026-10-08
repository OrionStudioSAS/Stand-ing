import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { mondaySalonRows, mondaySyncDate, mondaySyncDiagnostics, mondaySyncDuration, mondaySyncOutcome, mondaySyncStatus, mondaySyncSummary } from '../src/adminMonday.js';

test('Monday history formats real durations and legacy runs without invented counts', () => {
  assert.equal(mondaySyncDuration(94536), '1 min 35 s');
  assert.equal(mondaySyncDuration(null), '—');
  assert.equal(mondaySyncDuration(2500), '3 s');
  assert.equal(mondaySyncSummary({ status: 'success', processed_count: 2 }), '2 scènes créées');
  assert.equal(mondaySyncSummary({ status: 'success', result: { created: 1, invite_emails_sent: 0 } }), '1 scène créée · 0 e-mail envoyé');
  assert.equal(mondaySyncSummary({ status: 'error', error: 'Board inaccessible' }), 'Synchronisation non terminée.');
  const now = Date.parse('2026-10-08T10:00:00Z');
  assert.equal(mondaySyncDate('2026-10-08T08:12:00Z', now), 'Aujourd’hui, 10:12');
  assert.equal(mondaySyncDate('2026-10-07T08:12:00Z', now), 'Hier, 10:12');
  assert.equal(mondaySyncDate(null), 'Jamais');
  assert.equal(mondaySyncStatus({ status: 'started', created_at: '2026-10-08T09:59:00Z' }, now).label, 'En cours');
  assert.equal(mondaySyncStatus({ status: 'started', created_at: '2026-10-08T09:00:00Z' }, now).label, 'Interrompue');
  assert.equal(mondaySyncStatus({ status: 'warning' }).label, 'À vérifier');
});

test('RH feedback ignores routine diagnostics and shows only meaningful scene and invitation counts', () => {
  const outcome = mondaySyncOutcome({ created: 0, invite_emails_sent: 0, skipped_not_configurable: 13, skipped_not_first_send: 8, constraints_updated: 42, warnings: ['Columns available: 100 technical IDs', 'Mapping corrected'] });
  assert.equal(outcome.title, 'Synchronisation terminée');
  assert.equal(outcome.tone, 'success');
  assert.equal(outcome.description, 'Aucune nouvelle scène à créer.');
  assert.equal(mondaySyncOutcome({ created: 1, invite_emails_sent: 1 }).description, '1 nouvelle scène · 1 invitation envoyée.');
  assert.equal(mondaySyncOutcome({ created: 12, invite_emails_sent: 3 }).description, '12 nouvelles scènes · 3 invitations envoyées.');
  assert.equal(mondaySyncOutcome(null), null);
});

test('real synchronization failures and missing invitations are not disguised as success', () => {
  const partial = mondaySyncOutcome({ created: 2, invite_emails_skipped: 1 });
  assert.equal(partial.tone, 'warning');
  assert.match(partial.description, /1 invitation n’a pas pu être envoyée/);
  assert.match(mondaySyncOutcome({ invite_emails_skipped: 2 }).description, /2 invitations n’ont pas pu être envoyées/);
  assert.equal(mondaySyncOutcome({ errors: ['Missing layout'] }).tone, 'warning');
  const failed = mondaySyncOutcome(null, 'permission denied for schema private');
  assert.equal(failed.tone, 'error');
  assert.doesNotMatch(failed.description, /permission|schema|private/);
  assert.deepEqual(mondaySyncDiagnostics({ error: 'Problem', result: { errors: ['Problem'], warnings: ['Column diagnostic'] } }), ['Problem', 'Column diagnostic']);
});

test('shared feedback stays compact and retains technical failure details only in a closed disclosure', () => {
  const source = readFileSync(new URL('../src/AdminMondayView.jsx', import.meta.url), 'utf8');
  const component = source.slice(source.indexOf('export function MondaySyncFeedback'), source.indexOf('export default function')).replace('export ', '');
  const context = vm.createContext({ React, CheckCircle2: () => null, AlertCircle: () => null, mondaySyncOutcome, mondaySyncDiagnostics, mondaySyncDuration });
  vm.runInContext(transformSync(component, { loader: 'jsx', format: 'cjs' }).code, context);
  const render = (syncState) => renderToStaticMarkup(React.createElement(context.MondaySyncFeedback, { syncState }));
  const success = render({ result: { created: 0, duration_ms: 44000, warnings: ['Very long technical diagnostic'] } });
  assert.match(success, /Synchronisation terminée/);
  assert.match(success, /Durée : 44 s/);
  assert.doesNotMatch(success, /technical diagnostic|sync-result|<details/);
  const failed = render({ error: 'Database unavailable' });
  assert.match(failed, /role="alert"/);
  assert.match(failed, /<details[^>]*><summary>Détails techniques/);
  assert.doesNotMatch(failed, /<details[^>]*open/);
  assert.match(failed, /Database unavailable/);
  assert.equal(render({ loading: true, result: { created: 1 } }), '');
  assert.equal(render({ loading: false }), '');
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /<MondaySyncFeedback syncState=\{syncState\} \/>/);
  assert.doesNotMatch(app, /result\.warnings\.join|syncState\?\.message/);
});

test('associated boards use real active sources, deduplicate packs and attribute runs by source IDs', () => {
  const source = { id: 'source', board_id: '123', offer: 'Confort', mapping: { salon_from_group: true } };
  const run = { id: 'run', source_ids: ['source'], status: 'success' };
  const salons = [{ id: 'salon', name: 'SMCL 2026', monday_sources: [source, { id: 'inactive', offer: 'Prestige', is_active: false }], offers: [{ monday_source: source }] }, { id: 'empty', name: 'SITL 2027' }];
  const rows = mondaySalonRows(salons, [run]);
  assert.equal(rows[0].sources.length, 2);
  assert.deepEqual(rows[0].packs, ['Confort']);
  assert.equal(rows[0].organization, 'Par pack');
  assert.equal(rows[0].run, run);
  assert.equal(rows[1].organization, '—');
  assert.equal(rows[1].run, undefined);
  assert.equal(mondaySalonRows(salons, [run], '123').length, 1);
  assert.equal(mondaySalonRows(salons, [run], 'sitl')[0].salon.id, 'empty');
  assert.equal(mondaySalonRows(salons, [{ source_id: 'source' }])[0].run.source_id, 'source');
});

test('history reads a stable descending page plus one row, and surfaces database errors', async () => {
  const source = readFileSync(new URL('../src/data/sceneStore.js', import.meta.url), 'utf8');
  const method = source.slice(source.indexOf('export async function listMondaySyncRuns'), source.indexOf('export async function syncMondayScenes')).replace('export ', '');
  const calls = [];
  let error = null;
  const context = vm.createContext({ supabase: { from(table) {
    assert.equal(table, 'monday_sync_runs');
    return { select() { return this; }, order(...args) { calls.push(args); return this; }, async range(...args) { calls.push(args); return { data: [{ id: '1' }, { id: '2' }, { id: '3' }], error }; } };
  } } });
  vm.runInContext(method, context);
  const result = await context.listMondaySyncRuns(20, 2);
  assert.equal(result.runs.length, 2);
  assert.equal(result.hasMore, true);
  assert.deepEqual(calls.map(([key]) => key), ['created_at', 'id', 20]);
  assert.deepEqual(calls.at(-1), [20, 22]);
  error = new Error('Denied');
  await assert.rejects(context.listMondaySyncRuns(), /Denied/);
});
