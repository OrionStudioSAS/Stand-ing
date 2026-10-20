import test from 'node:test';
import assert from 'node:assert/strict';
import { carpetColors } from '../src/config/colorOptions.js';
import { signatureFootprintPalette, signatureFootprintSupplementLine } from '../src/signatureFootprint.js';
test('Signature grants only the eight requested colors and charges a flat 285 EUR for the others',()=>{
 const palette=signatureFootprintPalette(carpetColors);
 assert.deepEqual(palette.filter(c=>c.included).map(c=>c.name).sort(),['Jaune','Orange','Rouge','Fuchsia','Vert pistache','Bleu turquoise','Bleu marine','Noir'].sort());
 for(const color of palette) {
  const arch={type:'arche-signature',options:{signatureBaseKey:'arche',signatureArchColorId:color.id,signatureArchColorCode:color.code,signatureArchColorName:color.name}};
  const line=signatureFootprintSupplementLine([arch,arch]);
  if(color.included) assert.equal(line,null); else {assert.equal(line.total,285);assert.equal(line.quantity,1);}
 }
});
test('legacy scene color codes are reclassified without relying on stale price metadata',()=>{
 assert.equal(signatureFootprintSupplementLine([{options:{signatureBaseKey:'arche',signatureArchColorCode:'1964',signatureArchColorSupplement:285}}]),null);
 assert.equal(signatureFootprintSupplementLine([{options:{signatureBaseKey:'arche',signatureArchColorCode:'1893',signatureArchColorSupplement:0}}]).total,285);
 assert.equal(signatureFootprintSupplementLine([{type:'other',options:{signatureArchColorCode:'1893'}}]),null);
});

test('the configured Empreinte + arche SIGNATURE group keeps its 21 colors, eight included and thirteen paid', () => {
 const entries = [['0809','Marine'],['0939','Gris Clair'],['0400','Jaune'],['0200','Beige'],['0740','Bordeaux'],['0625','Vert Pré'],['0952','Gris Chiné Clair'],['0822','Turquoise'],['0713','Rouge'],['0450','Orange'],['0913','Noir'],['0524','Violet'],['0947','Gris Moyen'],['0960','Gris Foncé'],['0510','Fuchsia'],['0842','Bleu Nuit'],['0219','Sable'],['0840','Bleu Clair'],['0675','Pistache'],['0637','Vert Sapin'],['0936','Taupe']];
 const palette = signatureFootprintPalette(entries.map(([code,name])=>({id:`signature:${code}`,code,name})));
 assert.equal(palette.length,21);
 assert.equal(palette.filter(color=>color.included).length,8);
 assert.equal(palette.filter(color=>!color.included && color.price===285).length,13);
 assert.deepEqual(palette.map(color=>color.code),entries.map(([code])=>code));
 for(const color of palette) {
  const line=signatureFootprintSupplementLine([{options:{signatureBaseKey:'arche',signatureArchColorCode:color.code}}]);
  assert.equal(line?.total || 0,color.included ? 0 : 285);
 }
});
