import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTechnicalPlanEdits, moveTechnicalPlanElement } from '../src/technicalPlanEdits.js';

test('BAT edits stay bounded and keep original scene object identities without mutating inputs', () => {
  const input = { items: { 'child-1': { dx: 0.05, dy: -0.03 } }, annotations: [{ id: 'note', text: '<script>untrusted</script>', x: 0.5, y: 0.5 }], extras: [{ id: 'extra', type: 'chair', x: 0.5, y: 0.5 }] };
  const before = JSON.stringify(input);
  const moved = moveTechnicalPlanElement(input, 'child-1', 'item', 0.1, 0.05);
  assert.ok(Math.abs(moved.items['child-1'].dx - 0.15) < 1e-9);
  assert.ok(Math.abs(moved.items['child-1'].dy - 0.02) < 1e-9);
  assert.equal(moveTechnicalPlanElement(moved, 'note', 'annotation', 0.1, -0.1).annotations[0].x, 0.6);
  assert.equal(moveTechnicalPlanElement(moved, 'extra', 'extra', 0.1, -0.1).extras[0].y, 0.4);
  assert.equal(JSON.stringify(input), before);
  assert.equal(normalizeTechnicalPlanEdits(input).annotations[0].text, '<script>untrusted</script>', 'Text stays text; rendering escapes it, rather than inserting HTML');
  assert.equal(normalizeTechnicalPlanEdits({ items: { x: { dx: Infinity, dy: 100 } }, extras: [{ id: 'x', type: 'chair', width: -10, page: -1 }] }).items.x.dy, 1);
  assert.equal(normalizeTechnicalPlanEdits({ extras: [{ id: 'x', type: 'chair', width: -10 }] }).extras[0].width, 0.01);
});
