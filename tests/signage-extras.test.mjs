import assert from 'node:assert/strict';
import test from 'node:test';
import { signageExtraOptions, normalizedExtraChoices } from '../src/signageExtras.js';

test('overhead sign rotating kits and lighting form one optional exclusive choice',()=>{
  const input=[{id:'light',label:'Option lumière'},{id:'turn',label:'Kit tournette'},{id:'tech',label:'Technicien'}];
  const options=signageExtraOptions({label:'Enseigne haute'},input);
  assert.equal(options[0].exclusiveGroup,options[1].exclusiveGroup);
  assert.equal(options[0].required,false);
  assert.equal(options[2],input[2]);
  assert.deepEqual(normalizedExtraChoices(options,{light:true,turn:true,tech:true}),{light:false,turn:true,tech:true});
  assert.deepEqual(normalizedExtraChoices(options,{light:false,turn:false}),{light:false,turn:false});
  assert.equal(input[0].exclusiveGroup,undefined);
  assert.equal(signageExtraOptions({label:'TV'},input),input);
});
