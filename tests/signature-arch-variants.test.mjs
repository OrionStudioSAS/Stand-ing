import assert from 'node:assert/strict';
import test from 'node:test';
import { signatureArchVariant, signatureArchChoice, signatureArchSizeSupplementLines } from '../src/signatureArchVariants.js';

const entries = [1, 2, 3].flatMap(size => ['spot', 'suspension'].map(lighting => ({
  type: `arch-${size}m-${lighting}`,
  label: size === 1 ? `Arche Totem + Plafond ${lighting}` : `Arche Signature ${size}m + ${lighting}`,
  dimensions: { size:[1.1,3.64,size === 3 ? 3.52 : 2.52] },
})));
test('Commercial arch sizes use catalog names rather than the legacy model overhang', () => {
  for (const [index, entry] of entries.entries()) {
    const size = Math.floor(index / 2) + 1;
    assert.deepEqual(signatureArchVariant(entry), {size,lighting:index%2?'suspension':'spot',supplement:(size-1)*249});
  }
  assert.equal(signatureArchVariant({label:'Arche Totem + Plafond Spot',dimensions:{size:[1.1,3.64,2.52]}}).size,1);
});
test('Size and lighting select the exact combination without substituting a different size', () => {
  for (const entry of entries) {
    const {size,lighting}=signatureArchVariant(entry);
    assert.equal(signatureArchChoice(entries,size,lighting),entry);
  }
  assert.equal(signatureArchChoice(entries.slice(0,5),3,'suspension'),null);
});
test('The single arch size surcharge is independent from lighting and excludes unrelated assets', () => {
  for (const entry of entries) {
    const {size}=signatureArchVariant(entry);
    const lines=signatureArchSizeSupplementLines([{...entry,id:'arch',options:{signatureBaseKey:'arche'}},{label:'Comptoir 3m',type:'counter'}]);
    assert.equal(lines.length,size===1?0:1);
    if(size>1){assert.equal(lines[0].total,(size-1)*249);assert.equal(lines[0].quantity,1);}
  }
  assert.deepEqual(signatureArchSizeSupplementLines([{label:'Couleurs Arche Signature 3m',dimensions:{isColorGroup:true}}]),[]);
});
