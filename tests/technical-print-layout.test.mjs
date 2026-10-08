import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { technicalA3, paginateTechnicalPrintDetails, wrapTechnicalPrintText } from '../src/technicalPrintLayout.js';

const ctx = { measureText: (text) => ({ width: String(text).length * 8 }) };

test('Every technical page has the A3 landscape aspect ratio and a fixed printable area', () => {
  assert.equal(technicalA3.width / technicalA3.height, 420 / 297);
  assert.equal(technicalA3.widthMm, 420);
  assert.equal(technicalA3.heightMm, 297);
  assert.ok(technicalA3.bottom < technicalA3.height - 60);
});

test('Print wrapping preserves accents, explicit newlines and long references without ellipses', () => {
  const lines = wrapTechnicalPrintText(ctx, 'Référence\n' + 'X'.repeat(400), 200);
  assert.equal(lines[0], 'Référence');
  assert.equal(lines.slice(1).join(''), 'X'.repeat(400));
  assert.ok(lines.every((line) => ctx.measureText(line).width <= 200));
});

test('Long BATs paginate complete rows and repeat section headers instead of shrinking the page', () => {
  const rows = Array.from({ length: 70 }, (_, i) => ({ label: `${i + 1}. Un objet avec sa référence`, lines: ['Finition anthracite', 'Quantité 2', 'Une description technique'] }));
  const pages = paginateTechnicalPrintDetails(ctx, [{ title: 'AMCO', rows }], []);
  assert.ok(pages.length > 2);
  assert.equal(pages.flatMap((page) => page.blocks).filter((block) => block.kind === 'row').length, 70);
  pages.forEach((page) => {
    assert.equal(page.blocks[0].title, 'AMCO');
    assert.ok(page.blocks.every((block) => block.y >= technicalA3.top && block.y + block.height <= technicalA3.bottom));
  });
});

test('A single oversized description continues across A3 pages without dropping lines', () => {
  const lines = Array.from({ length: 140 }, (_, i) => `Description ${i + 1}`);
  const pages = paginateTechnicalPrintDetails(ctx, [{ title: 'AMCO', rows: [{ label: 'Objet 1', lines }] }], []);
  assert.ok(pages.length >= 3);
  const rows = pages.flatMap((page) => page.blocks).filter((block) => block.kind === 'row');
  assert.deepEqual(rows.flatMap((row) => row.lines.map(([, detail]) => detail)), lines);
  assert.equal(rows[1].continued, true);
});

test('Visual cards move whole onto another page and retain every plan reference', () => {
  const visuals = Array.from({ length: 19 }, (_, i) => ({ reference: `S${i + 1}`, label: 'Affiche', placement: 'Mur de la réserve', status: 'Visuel enregistré' }));
  const pages = paginateTechnicalPrintDetails(ctx, [], visuals);
  assert.ok(pages.length > 1);
  assert.deepEqual(pages.flatMap((page) => page.blocks.filter((block) => block.kind === 'visuals').flatMap((block) => block.cards.map((card) => card.reference))), visuals.map((visual) => visual.reference));
  assert.ok(pages.every((page) => page.blocks.every((block) => block.y + block.height <= technicalA3.bottom)));
});

test('BAT downloads and email attachments both use the multipage PDF export', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const download = app.slice(app.indexOf('async function downloadSceneTechnicalPlan('), app.indexOf('function withTechnicalOptionsMarker('));
  assert.match(download, /exportTechnicalPdf\(/);
  assert.match(download, /-A3\.pdf/);
  assert.match(download, /contentType: 'application\/pdf'/);
  assert.doesNotMatch(download, /exportTechnicalPng|image\/png/);
  const exporter = readFileSync(new URL('../src/technicalExport.js', import.meta.url), 'utf8');
  assert.match(exporter, /pdf\.addPage\('a3', 'landscape'\)/);
  assert.match(exporter, /await pdf\.svg\(page/);
  assert.doesNotMatch(exporter.slice(exporter.indexOf('export async function createTechnicalPlanBlob('), exporter.indexOf('function technicalItemsForPlan(')), /canvasToBlob|drawImage|embedPng/);
});
