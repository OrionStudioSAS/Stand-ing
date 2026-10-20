import test from 'node:test';
import assert from 'node:assert/strict';
import {equippedHeadCountryCode,sceneHeadCountry,equippedHeadMaterialFace,drawEquippedHeadInformation} from '../src/equippedHeadInformation.js';
const sceneWithCountry=(text,value)=>({source_payload:{column_values:[{id:'text_country',column:{title:'PAYS'},text,value}]}});
test('equipped flags follow Monday PAYS, with French default for an empty column even in English',()=>{
 for(const [country,code] of [['USA','US'],['France','FR'],['États-Unis','US'],['United States','US'],['FR','FR'],['DE','DE'],['Allemagne','DE'],['Belgique','BE'],['Suisse','CH'],['Royaume-Uni','GB'],['UK','GB'],['Canada','CA'],['Japon','JP'],['Émirats arabes unis','AE'],['','FR']]) {
  assert.equal(equippedHeadCountryCode(country),code,country);assert.equal(sceneHeadCountry(sceneWithCountry(country)),code,country);
 }
 assert.equal(sceneHeadCountry({...sceneWithCountry(''),options:{language:'en'},source_payload:{...sceneWithCountry('').source_payload,contactDetails:{country:'USA'}}}),'FR');
 assert.equal(sceneHeadCountry(sceneWithCountry('',JSON.stringify({countryCode:'US',countryName:'United States'}))),'US');
 assert.equal(sceneHeadCountry(sceneWithCountry('',JSON.stringify('USA'))),'US');
 assert.equal(sceneHeadCountry({source_payload:{pays:'USA'}}),'US');
 assert.equal(sceneHeadCountry({source_payload:{country:'USA',contactDetails:{country:'USA'}}}),'FR');
 assert.equal(equippedHeadCountryCode('Not a country'),'FR');
});
test('the two equipped faces target exact _1 and _2 materials without touching the vertical visual',()=>{
 for(const name of ['_1','1','_1.001'])assert.equal(equippedHeadMaterialFace(name),'front');
 for(const name of ['_2','2','_2.002'])assert.equal(equippedHeadMaterialFace(name),'back');
 for(const name of ['LED_5500k_1','LED_5500k_2','_10','_12','Laminate_D02_120cm_2'])assert.equal(equippedHeadMaterialFace(name),null);
});
test('recto and verso keep readable text, with the flag and stand number on their authored sides',()=>{
 for(const face of ['front','back']) {
  const text=[],rectangles=[];
  const ctx={fillRect(x,y,w,h){rectangles.push({x,y,w,h,color:this.fillStyle});},measureText(text){return{width:text.length*parseFloat(this.font.split(' ')[1])*.5};},fillText(value,x,y){text.push({value,x,y,font:this.font});}};
  const info=drawEquippedHeadInformation(ctx,{company:'Société Aéro',standNumber:'21',aisleNumber:'A',language:'en'},face);
  assert.equal(info.company,'SOCIÉTÉ AÉRO');assert.equal(info.stand,'A21');assert.equal(info.country,'FR');assert.equal(text[0].value,'SOCIÉTÉ AÉRO');assert.equal(text[1].value,'A21');
  assert.equal(text[1].x,face==='front'?544:22);assert.equal(rectangles[1].x,face==='front'?22:568);assert.equal(rectangles[1].color,'#002395');
  assert.equal(ctx.textAlign,'left');assert.equal(typeof ctx.scale,'undefined','No mirrored canvas transform is needed');
 }
});
