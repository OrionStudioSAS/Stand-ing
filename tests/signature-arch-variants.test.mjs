import assert from 'node:assert/strict';
import test from 'node:test';
import { signatureArchVariant, isSignatureLedArch, signatureArchChoice, signatureArchSizeSupplementLines, upgradeLegacySignatureArch, isLegacySignatureArch, signatureArchFitsDepth } from '../src/signatureArchVariants.js';

const entries = [2, 3].flatMap(size => ['spot', 'suspension'].map(lighting => ({
  type: `arch-${size}m-${lighting}`,
  label: `Arche Signature ${size}m + ${lighting}`,
  dimensions: { size:[1.1,3.64,size === 3 ? 3.52 : 2.52] },
})));
test('Commercial arch sizes use catalog names rather than the legacy model overhang', () => {
  for (const [index, entry] of entries.entries()) {
    const size = Math.floor(index / 2) + 2;
    assert.deepEqual(signatureArchVariant(entry), {size,lighting:index%2?'suspension':'spot',supplement:(size-2)*249});
  }
  assert.equal(signatureArchVariant({label:'Arche Totem + Plafond Spot',dimensions:{size:[1.1,3.64,2.52]}}).size,2);
});
test('Size and lighting select the exact combination without substituting a different size', () => {
  for (const entry of entries) {
    const {size,lighting}=signatureArchVariant(entry);
    assert.equal(signatureArchChoice(entries,size,lighting),entry);
  }
  assert.equal(signatureArchChoice(entries.slice(0,3),3,'suspension'),null);
});
test('The single arch size surcharge is independent from lighting and excludes unrelated assets', () => {
  for (const entry of entries) {
    const {size}=signatureArchVariant(entry);
    const lines=signatureArchSizeSupplementLines([{...entry,id:'arch',options:{signatureBaseKey:'arche'}},{label:'Comptoir 3m',type:'counter'}]);
    assert.equal(lines.length,size===2?0:1);
    if(size>2){assert.equal(lines[0].total,(size-2)*249);assert.equal(lines[0].quantity,1);}
  }
  assert.deepEqual(signatureArchSizeSupplementLines([{label:'Couleurs Arche Signature 3m',dimensions:{isColorGroup:true}}]),[]);
});

test('Old arches migrate to the current 2 m model with the same lighting and all artwork options', () => {
  for (const lighting of ['spot','suspension']) {
    const old = { id:'old',label:`Arche Totem + Plafond ${lighting}`,type:`asset-totem-plafond-${lighting}`,x:.5,z:-.68,
      options:{signatureArchSizeM:1,signatureArchSizeSupplement:249,signatureArchColorHex:'#bb2233',textureSlotValues:{front:{imageUrl:'front.png',imageZoom:1.4}}} };
    const result = upgradeLegacySignatureArch(old,entries);
    assert.equal(result.type,signatureArchChoice(entries,2,lighting).type);
    assert.equal(result.id,old.id);assert.equal(result.x,old.x);assert.equal(result.z,old.z);
    assert.equal(result.options.signatureArchColorHex,old.options.signatureArchColorHex);
    assert.equal(result.options.textureSlotValues,old.options.textureSlotValues);
    assert.equal(result.options.signatureArchSizeM,2);assert.equal(result.options.signatureArchSizeSupplement,0);
    assert.deepEqual(signatureArchSizeSupplementLines([result]),[]);
    assert.equal(upgradeLegacySignatureArch(old,[]),old);
    assert.ok(isLegacySignatureArch(old));
  }
  assert.equal(upgradeLegacySignatureArch(entries[2],entries),entries[2]);
});

test('3m arches require at least 3m of stand depth for both lighting options',()=>{
 for (const entry of entries) {
  const {size}=signatureArchVariant(entry);
  for (const depth of [2,2.5,2.99,2.9999]) assert.equal(signatureArchFitsDepth(entry,depth),size===2);
  for (const depth of [3,3.01,4]) assert.equal(signatureArchFitsDepth(entry,depth),true);
 }
});

const ledEntries = entries.map(entry => ({...entry,type:entry.type.replace('arch-', 'asset-mur-led-signature-'),label:entry.label.replace('Arche', 'Mur LED')}));
test('LED wall choices keep all three axes independent even when LED assets come first', () => {
  const catalog = [...ledEntries, ...entries];
  for (const entry of entries) {
    const {size,lighting} = signatureArchVariant(entry);
    assert.equal(signatureArchChoice(catalog,size,lighting),entry);
    const led = signatureArchChoice(catalog,size,lighting,true);
    assert.ok(isSignatureLedArch(led));
    assert.equal(signatureArchVariant(led).size,size);
    assert.equal(signatureArchVariant(led).lighting,lighting);
    assert.equal(signatureArchFitsDepth(led,2.99),size===2);
    assert.equal(signatureArchChoice(entries,size,lighting,true),null);
  }
});
test('LED wall costs 2570 once plus the 3m supplement and keeps optional carpet pricing', () => {
  for (const entry of ledEntries) {
    const lines=signatureArchSizeSupplementLines([{...entry,id:'led'}]);
    const size=signatureArchVariant(entry).size;
    assert.equal(lines.filter(line=>line.type.startsWith('signature-arch-led-wall-')).length,1);
    assert.equal(lines.reduce((total,line)=>total+line.total,0),2570+(size===3?249:0));
  }
  assert.deepEqual(signatureArchSizeSupplementLines([{...ledEntries[0],dimensions:{isColorGroup:true}}]),[]);
});
