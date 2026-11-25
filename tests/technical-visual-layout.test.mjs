import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutTechnicalVisuals, technicalFrontPage, technicalVisualSections } from '../src/technicalVisualLayout.js';
import { technicalA3 } from '../src/technicalPrintLayout.js';

const visual = (role, id, extra = {}) => ({ role, imageUrl: `${id}.png`, label: id, status: 'Visuel fourni', position: [0, 0, 0], ...extra });

test('the five artwork sections retain their order, including absent head and sign artwork', () => {
  const empty = layoutTechnicalVisuals();
  assert.deepEqual(empty.slots.map(({ number, title }) => [number, title]), [
    [1, 'Tête de cloison visuel'], [2, 'Tête de cloison texte'], [3, 'Adhésif banque accueil'],
    [4, 'Viscom suspendu'], [5, 'Bâche cloison'],
  ]);
  assert.ok(empty.slots.every((slot) => slot.primary === null));
  const axione = layoutTechnicalVisuals([visual('counter', 'logo')]);
  assert.deepEqual(axione.slots.map((slot) => slot.primary?.reference || 'NON'), ['NON', 'NON', '3', 'NON', 'NON']);
  assert.deepEqual(axione.galleries, [[]]);
});

test('artwork roles, rather than item order, determine their fixed references', () => {
  const result = layoutTechnicalVisuals([
    visual('wall-banner', 'banner'), visual('counter', 'logo'), visual('hanging-sign', 'sign'),
    visual('head-text', 'company'), visual('head-visual', 'head'),
  ]);
  assert.deepEqual(result.slots.map((slot) => slot.primary.reference), ['1', '2', '3', '4', '5.1']);
  assert.deepEqual(result.slots.map((slot) => slot.role), technicalVisualSections.map((slot) => slot.role));
});

test('identical artwork shares one preview without losing either plan position', () => {
  const left = visual('head-visual', 'shared', { position: [-3, 0, 1] });
  const right = visual('head-visual', 'shared', { position: [3, 0, 1] });
  const result = layoutTechnicalVisuals([left, right]);
  assert.equal(result.slots[0].visuals.length, 1);
  assert.equal(result.slots[0].primary.occurrences.length, 2);
  assert.deepEqual(result.visuals.map((entry) => entry.position), [left.position, right.position]);
  assert.deepEqual(result.visuals.map((entry) => entry.reference), ['1', '1']);
  assert.equal(result.extra.length, 0);
  assert.equal(left.reference, undefined, 'Source artwork is not mutated');
  assert.equal(layoutTechnicalVisuals([left, visual('head-text', 'shared')]).slots[1].primary.reference, '2', 'Text and graphic roles remain separate');
});

test('additional artwork stays under the plan and paginates without omission', () => {
  const banners = Array.from({ length: 19 }, (_, index) => visual('wall-banner', `banner-${index}`));
  const result = layoutTechnicalVisuals([...banners, visual('other', 'custom')]);
  assert.equal(result.slots[4].primary.reference, '5.1');
  assert.equal(result.extra.length, 19);
  assert.equal(result.galleries.length, 5);
  assert.ok(result.galleries.every((page) => page.length <= technicalFrontPage.gallery.columns));
  assert.deepEqual(result.galleries.flat().map((entry) => entry.imageUrl), result.extra.map((entry) => entry.imageUrl));
  assert.equal(result.extra[0].reference, '5.2');
  assert.equal(result.extra.at(-1).reference, '6.1');
});

test('selected but missing artwork remains pending instead of being marked absent', () => {
  const result = layoutTechnicalVisuals([visual('head-visual', '', { imageUrl: '', status: 'En attente - visuel à fournir plus tard' })]);
  assert.ok(result.slots[0].primary);
  assert.equal(result.slots[1].primary, null);
});

test('fixed artwork, footer and supplementary gallery fit on an A3 sheet', () => {
  const { sidebar, gallery, footer, legend } = technicalFrontPage;
  assert.ok(sidebar.y + sidebar.cardHeight * 4 < footer.y + footer.height);
  assert.ok(gallery.y + gallery.height < footer.y);
  assert.ok(footer.y + footer.height < technicalA3.height - technicalA3.margin);
  assert.ok(footer.x + footer.bannerWidth + footer.notesWidth + footer.finishesWidth + 24 < technicalA3.width - technicalA3.margin);
  assert.ok(legend.x + legend.width < technicalA3.width - technicalA3.margin);
});
