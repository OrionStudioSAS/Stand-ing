import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { reserveGroupDetails, hasSignatureMeterCoverChoice } from '../src/reserveOptionsPresentation.js';

const entries = JSON.parse(readFileSync(new URL('./fixtures/signature-reserve-message-catalog.json', import.meta.url)));

test('reserve details read authored groups and do not count doors or walls as equipment', () => {
  const before = structuredClone(entries);
  for (const entry of entries) {
    const details = reserveGroupDetails(entry);
    assert.equal(details.placement, 'back-right');
    assert.equal(details.doors.length, 1);
    assert.equal(details.equipmentCount, 3);
    assert.deepEqual(details.equipment.map((child) => child.label.trim()).sort(), ['Patère', 'Bloc 3 Étagères', 'Triplette'].sort());
    assert.equal(details.handle, entry.label.includes('1m2') ? 'right' : 'left');
    assert.equal(details.opening, '', 'Do not invent a push/pull direction from the door model');
  }
  assert.deepEqual(entries, before);
});

test('saved options override model labels; current placement and nested equipment are respected', () => {
  const details = reserveGroupDetails(entries[0], { placementRule: null, children: [{ label: 'Group', children: [{ label: 'Cloison' }, { label: 'Étagère', quantity: 3 }, { label: 'Porte' }] }] }, { doorOpening: 'pull', handleOrientation: 'left' });
  assert.equal(details.opening, 'pull');
  assert.equal(details.handle, 'left');
  assert.equal(details.placement, '');
  assert.equal(details.equipmentCount, 3);
  assert.deepEqual(reserveGroupDetails().equipment, []);
  assert.deepEqual(reserveGroupDetails(null, null).equipment, []);
});

test('meter-cover controls require an existing included object, Signature and a surface from 9 to under 15 m²', () => {
  for (const area of [0, 8.99, 15, 24, NaN]) assert.equal(hasSignatureMeterCoverChoice(true, area, {}), false);
  for (const area of [9, 10, 14.999]) {
    assert.equal(hasSignatureMeterCoverChoice(true, area, {}), true);
    assert.equal(hasSignatureMeterCoverChoice(false, area, {}), false);
    assert.equal(hasSignatureMeterCoverChoice(true, area, undefined), false);
  }
});

test('reserve door metadata appears once in flattened BAT equipment without changing geometry', () => {
  const source = readFileSync(new URL('../src/technicalExport.js', import.meta.url), 'utf8');
  const context = vm.createContext({ console });
  for (const name of ['technicalItemOptionLines', 'technicalSelectedColorCandidate', 'isTechnicalColorReference', 'cleanTechnicalColorName', 'uniqueTechnicalLines', 'normalizeTechnicalText', 'technicalChildOptions', 'hasTechnicalValue']) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const end = source.indexOf('\nfunction ', start + 1);
    vm.runInContext(source.slice(start, end < 0 ? undefined : end), context);
  }
  const options = { reserveDoorOpening: 'pull', reserveHandleOrientation: 'right' };
  const first = context.technicalChildOptions({}, options, {}, 0);
  assert.match(context.technicalItemOptionLines({ options: first }).join('\n'), /Ouverture de porte : Tirante\nOrientation de la poignée : Droite/);
  assert.doesNotMatch(context.technicalItemOptionLines({ options: context.technicalChildOptions({}, options, {}, 1) }).join('\n'), /Ouverture|poignée/);
});
