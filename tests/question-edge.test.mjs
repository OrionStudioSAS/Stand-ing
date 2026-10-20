import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import ts from 'typescript';
const source=readFileSync(new URL('../supabase/functions/scene-question-email/index.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
function harness(email=false) {
 let scene={id:'s',share_token:'secret-link',updated_at:'2026-10-20T00:00:00Z',source_payload:{other:'preserved'}};let handler;
 const supabase={auth:{getUser:async()=>({data:{user:null}})},from(table){
  let patch=null;const filters=[];
  const chain={select(){return chain},limit(){return chain},eq(k,v){filters.push([k,v]);return chain},is(k,v){filters.push([k,v]);return chain},update(value){patch=value;return chain},
   then(resolve,reject){return Promise.resolve({data:table==='scenes'?[structuredClone(scene)]:[],error:null}).then(resolve,reject)},
   async maybeSingle(){if(patch){if(filters.some(([k,v])=>scene[k]!==v))return {data:null,error:null};scene={...scene,...patch};return {data:{id:scene.id},error:null};}return {data:null,error:null}}};return chain;
 }};
 const context=vm.createContext({Deno:{env:{get:key=>key==='RESEND_API_KEY'?(email?'test-key':''):''},serve:value=>{handler=value}},createClient:()=>supabase,crypto:webcrypto,Response,Request,AbortSignal,fetch:async()=>new Response('{}',{status:502}),console});
 vm.runInContext(js,context);
 return {request:body=>handler(new Request('https://test.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})),scene:()=>scene};
}
test('question persists in admin data even when email is not configured, preserving other payload fields',async()=>{
 const h=harness();const result=await h.request({sceneId:'s',shareToken:'secret-link',requestId:'q1',subject:'Question',message:'Remarque'});assert.equal(result.status,200);assert.equal((await result.json()).saved,true);assert.equal(h.scene().source_payload.questions.length,1);assert.equal(h.scene().source_payload.other,'preserved');
 const duplicate=await h.request({sceneId:'s',shareToken:'secret-link',requestId:'q1',subject:'Question'});assert.equal((await duplicate.json()).duplicate,true);assert.equal(h.scene().source_payload.questions.length,1);
});
test('invalid scene token cannot store a question or trigger email',async()=>{
 const h=harness();assert.equal((await h.request({sceneId:'s',shareToken:'wrong',subject:'Question'})).status,401);assert.equal(h.scene().source_payload.questions,undefined);
});
test('email delivery failure retains the question and returns a saved acknowledgement',async()=>{
 const h=harness(true);const result=await h.request({sceneId:'s',shareToken:'secret-link',subject:'Question'});assert.equal(result.status,200);assert.equal((await result.json()).saved,true);assert.equal(h.scene().source_payload.questions.length,1);
});
