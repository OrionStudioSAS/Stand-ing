import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { wallCoverPackTariff, wallCoverQuote } from '../src/wallCoverPricing.js';
import { lastSceneSyncAt, sceneSyncLabel } from '../src/sceneSyncInfo.js';
import { normalizeBatElectricalPicto } from '../src/batElectricalPicto.js';
import { withPackAllowance } from '../supabase/functions/_shared/packBenefits.js';
import { mergeManualOrderPricing } from '../src/manualOrderLines.js';

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const load = (api, name) => {
  let start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2), api);
};

test('wall-cover tariffs follow the supplied pack table at every area boundary', () => {
  assert.deepEqual(wallCoverPackTariff('Confort'), { unitPrice: 288, includedMl: 2 });
  assert.deepEqual(wallCoverPackTariff('Prestige'), { unitPrice: 288, includedMl: 4 });
  assert.deepEqual(wallCoverPackTariff('Équipé'), { unitPrice: 253, includedMl: 0 });
  for (const [area, includedMl] of [[8.99, 0], [9, 2], [14.99, 2], [15, 3], [23.99, 3], [24, 3.5], [35.99, 3.5], [36, 4]]) {
    assert.deepEqual(wallCoverPackTariff({ offer: 'Signature', dimensions: { width: area, depth: 1 } }), { unitPrice: 249, includedMl });
  }
});

test('wall-cover allowance is a capped global deduction, independent of surface order', () => {
  const surfaces = [{ width: 4.5, visibleWidth: 4.41 }];
  assert.deepEqual(wallCoverQuote(surfaces, 3, 249), { quantity: 4.41, included: 3, billable: 1.41, unitPrice: 249, subtotal: 1098.09, discount: 747, total: 351.09 });
  assert.equal(wallCoverQuote(surfaces, 3, 288).total, 406.08);
  assert.equal(wallCoverQuote(surfaces, 0, 253).total, 1115.73);
  assert.equal(wallCoverQuote([{ width: 1 }], 3, 249).total, 0);
  assert.equal(wallCoverQuote([], 3, 249).discount, 0);
  const a = [{ width: 1.23 }, { width: 3.18 }];
  assert.deepEqual(wallCoverQuote(a, 3, 249), wallCoverQuote(a.toReversed(), 3, 249));
});

test('header cart charges only the same billable quantities and item supplements as step four', () => {
  const api = vm.createContext({ Map });
  for (const name of ['cartItemPrice', 'roundCurrency']) load(api, name);
  api.cartItemBasePrice = item => item.price;
  api.textureSlotColorSupplement = () => 0;
  const items = [{ id: 'included', type: 'chair', price: 85.5 }, { id: 'extra', type: 'chair', price: 85.5 }];
  const pricing = { includedCounts: new Map([['chair', 1]]), lines: [{ optionForItemId: 'included', total: 12.25 }] };
  assert.equal(api.cartItemPrice(items[0], {}, '', pricing, items), 12.25);
  assert.equal(api.cartItemPrice(items[1], {}, '', pricing, items), 85.5);
  pricing.lines = [];
  assert.equal(api.cartItemPrice(items[0], {}, '', pricing, items), 0);
});

test('banner deduction precedes the Signature accessories allowance in saved and manual orders', () => {
  const lines = [{ type: 'wall-cover', quantity: 4.41, unitPrice: 249, total: 1098.09 },
    { type: 'wall-cover-allowance', quantity: 1, unitPrice: -747, total: -747 }];
  const benefits = { mode: 'allowance', allowanceAmount: 800 };
  const result = withPackAllowance(lines, benefits);
  assert.equal(result.at(-1).total, -351.09);
  assert.ok(Math.abs(result.reduce((sum, line) => sum + line.total, 0)) < .005);
  const pricing = mergeManualOrderPricing({ lines }, [], benefits);
  assert.ok(Math.abs(pricing.total) < .005);
  assert.equal(pricing.allowanceRemaining, 448.91);
  assert.equal(pricing.allowanceApplied, 351.09);
});

test('real purchase-order PDF retains centimes in HT, VAT, TTC and the wall-cover discount', async () => {
  const template = readFileSync(new URL('../public/templates/bon-commande-template.pdf', import.meta.url));
  const api = vm.createContext({ PDFDocument, StandardFonts, Blob, Uint8Array, console, uniqueTextValues: values => [...new Set(values)], packAllowanceLineType: 'allowance',
    fetch: async () => ({ ok: true, arrayBuffer: async () => Uint8Array.from(template).buffer }) });
  for (const name of ['roundCurrency', 'fillPurchaseOrderTemplate', 'purchaseOrderTemplateRows', 'purchaseOrderTemplateFieldMap', 'drawPurchaseOrderHeaderLine', 'setPdfFieldAny', 'moneyPdf', 'toPdfWinAnsi', 'truncatePdfText']) load(api, name);
  const lines = [{ type: 'wall-cover', label: 'Bâches', quantity: 4.41, unitPrice: 249, total: 1098.09 }, { type: 'wall-cover-allowance', label: 'Forfait inclus', quantity: 1, unitPrice: -747, total: -747 }];
  const blob = await api.fillPurchaseOrderTemplate({ lines, total: 351.09 });
  const pdf = await PDFDocument.load(await blob.arrayBuffer()); const form = pdf.getForm(); const fields = api.purchaseOrderTemplateFieldMap(form);
  assert.equal(form.getTextField(fields.total).getText(), '351,09 €');
  assert.equal(form.getTextField(fields.tva).getText(), '70,22 €');
  assert.equal(form.getTextField(fields.totalTtc).getText(), '421,31 €');
  assert.equal(form.getTextField(fields.rows[1].total).getText(), '-747,00 €');
});

test('electrical pictograms use a common physical size and may extend beyond the main pictogram', () => {
  assert.deepEqual(normalizeBatElectricalPicto({ batElectricalPictoUrl: '/electric.svg' }), { url: '/electric.svg', path: '', x: .5, y: .5, size: .2 });
  const icon = normalizeBatElectricalPicto({ batElectricalPictoX: 100, batElectricalPictoY: -1, batElectricalPictoSize: .4 });
  assert.equal(icon.x, 5); assert.equal(icon.y, -1); assert.equal(icon.size, .2);
  assert.equal(normalizeBatElectricalPicto({ batElectricalPictoX: 'invalid' }).x, .5);
});

test('scene sync dates reflect actual Monday syncs, not unrelated scene edits', () => {
  assert.equal(lastSceneSyncAt({ updated_at: '2026-10-26T12:34:00Z' }), '');
  assert.equal(sceneSyncLabel({}), 'Non renseignée');
  const scene = { source_payload: { monday_synced_at: '2026-10-25T12:00:00Z', monday_config_synced_at: '2026-10-26T12:34:00Z' } };
  assert.equal(lastSceneSyncAt(scene), '2026-10-26T12:34:00Z');
  assert.match(sceneSyncLabel(scene), /26\/10\/2026.*13:34/);
});
