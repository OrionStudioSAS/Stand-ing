import test from 'node:test';
import assert from 'node:assert/strict';
import { drawSignatureHeadInformation, signatureHeadSide } from '../src/signatureHeadInformation.js';
function context() {
 const calls=[];
 const ctx={ font:'', fillStyle:'', textAlign:'', fillRect(){},measureText(text){return {width:text.length * parseFloat(this.font.split(' ')[1]) * 0.7};},fillText(text,x,y){calls.push({text,x,y,color:this.fillStyle,align:this.textAlign,font:this.font});} };
 return {ctx,calls};
}
test('Signature centers the company and aligns the orange stand code with each head side',()=>{
 for(const side of ['left','right']) {
  const {ctx,calls}=context();
  drawSignatureHeadInformation(ctx,{company:'Société Énergie',standNumber:'Stand G25'},{options:{partitionHeadSide:side}});
  const code=calls.at(-1);assert.equal(code.text,'G25');assert.equal(code.color,'#f25723');assert.equal(code.x,side==='left'?70:1330);assert.equal(code.align,side);assert.match(code.font,/900 .*Gotham/);
  assert.equal(calls.slice(0,-1).map(c=>c.text).join(' '),'SOCIÉTÉ ÉNERGIE');
  assert.ok(calls.slice(0,-1).every(c=>c.x===700 && c.align==='center' && c.font.startsWith('500 ')));
 }
});
test('Signature fits long names and codes without cropping or borrowing the example stand number',()=>{
 const {ctx,calls}=context();
 const result=drawSignatureHeadInformation(ctx,{company:'INTERNATIONALE'.repeat(30),standNumber:'HALL-A-12345678901234567890'},{label:'Tête de cloison Signature droite'});
 assert.equal(result.side,'right');assert.ok(result.companyFontSize<144);assert.ok(result.lines.length<=3);
 for(const call of calls){ctx.font=call.font;assert.ok(ctx.measureText(call.text).width <= (call.color==='#f25723'?600:1050));}
 const empty=context();drawSignatureHeadInformation(empty.ctx,{},{});assert.equal(empty.calls.at(-1).text,'');
 assert.equal(signatureHeadSide({options:{partitionHeadSide:'left'},label:'droite'}),'left');
});
