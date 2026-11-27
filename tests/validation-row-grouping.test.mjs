import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const api = vm.createContext({ Map, Number, String });
for (const name of ['groupValidationRows', 'validationBadgeAmount', 'validationBadgeText', 'validationMoney', 'roundCurrency']) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2), api);
}

const plain = (value) => JSON.parse(JSON.stringify(value));

test('identical recap rows collapse into one row with a quantity', () => {
  const stool = { label: 'Tabouret', detail: '', badge: 'Inclus', badgeTone: 'included' };
  const rows = plain(api.groupValidationRows([
    { ...stool, id: 'a' }, { id: 'ficus', label: 'Ficus', badge: 'Inclus', badgeTone: 'included' },
    { ...stool, id: 'b' }, { ...stool, id: 'c' }, { ...stool, id: 'd' },
  ]));
  assert.deepEqual(rows.map((row) => [row.label, row.quantity]), [['Tabouret', 4], ['Ficus', 1]]);
});

test('paid identical rows add their prices; different details or attached options stay apart', () => {
  const chair = { label: 'Chaise', detail: 'Noir', badge: '+ 72€', badgeTone: 'price' };
  const rows = plain(api.groupValidationRows([
    { ...chair, id: 'a' }, { ...chair, id: 'b' }, { ...chair, id: 'c', detail: 'Blanc' },
    { ...chair, id: 'd' }, { id: 'd-opt', label: 'Option', option: true, badge: '+ 10€' },
    { id: 'head-r', label: 'Tête de cloison', detail: 'Droite', badge: 'Inclus', badgeTone: 'included' },
    { id: 'head-l', label: 'Tête de cloison', detail: 'Gauche', badge: '+ 945€', badgeTone: 'price' },
  ]));
  assert.deepEqual(rows.map((row) => [row.id, row.quantity, row.badge.replace(/\s/g, ' ')]), [
    ['a', 2, '+ 144€'], ['c', 1, '+ 72€'], ['d', 1, '+ 72€'], ['d-opt', 1, '+ 10€'],
    ['head-r', 1, 'Inclus'], ['head-l', 1, '+ 945€'],
  ]);
  assert.equal(api.validationBadgeAmount('+ 1 416,50€'), 1416.5);
});
