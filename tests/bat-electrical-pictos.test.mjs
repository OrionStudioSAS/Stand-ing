import assert from 'node:assert/strict';
import test from 'node:test';
import { batElectricalPictosMetadata, normalizeBatElectricalPictos, electricalPictoPoint } from '../src/batElectricalPicto.js';

test('legacy electrical pictos remain readable and retain their size and position', () => {
  assert.deepEqual(normalizeBatElectricalPictos({ batElectricalPictoUrl: '/legacy.svg', batElectricalPictoX: -.5, batElectricalPictoY: 1.2, batElectricalPictoSizeMeters: .3 }),
    [{ url: '/legacy.svg', path: '', x: -.5, y: 1.2, size: .3 }]);
});

test('several electrical pictos retain independent physical sizes and may extend outside the object', () => {
  const icons = [{ url: '/a.svg', x: -.5, y: .5, size: .2 }, { url: '/b.svg', x: 1.5, y: 0, size: .3 }];
  const metadata = batElectricalPictosMetadata(icons);
  const normalized = normalizeBatElectricalPictos(JSON.parse(JSON.stringify(metadata)));
  assert.equal(normalized.length, 2);
  assert.equal(normalized[1].size, .3);
  const frame = { x: 100, y: 100, width: 200, height: 100 };
  assert.deepEqual(electricalPictoPoint(frame, normalized[0]), { x: -100, y: 100 });
  assert.deepEqual(electricalPictoPoint(frame, normalized[1]), { x: 300, y: 50 });
  assert.equal(metadata.batElectricalPictoUrl, '/a.svg', 'Keep the first icon compatible with old scene snapshots');
});

test('an empty explicit list does not resurrect a legacy picto and deletion preserves other icons', () => {
  assert.deepEqual(normalizeBatElectricalPictos({ batElectricalPictos: [], batElectricalPictoUrl: '/stale.svg' }), []);
  const icons = [{ url: '/a.svg', x: .2, y: .3 }, { url: '/b.svg', x: .8, y: -.5 }];
  const metadata = batElectricalPictosMetadata(icons.slice(1));
  assert.equal(metadata.batElectricalPictoUrl, '/b.svg');
  assert.equal(normalizeBatElectricalPictos(metadata)[0].y, -.5);
  assert.deepEqual(normalizeBatElectricalPictos(batElectricalPictosMetadata([])), []);
  assert.deepEqual(normalizeBatElectricalPictos({ batElectricalPictos: [null, {}, { url: '/valid.svg', x: 100, y: -100, size: 0 }] }),
    [{ url: '/valid.svg', path: '', x: 5, y: -4, size: .05 }]);
});
