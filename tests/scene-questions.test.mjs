import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {sceneAdminRequests,questionAsRequest} from '../src/sceneRequests.js';
test('admin lists every question alongside the special request of the same scene',()=>{
 const scene={id:'scene',source_payload:{specialRequest:{text:'Demande initiale'},questions:[{id:'q1',subject:'Sol',message:'Couleur ?',status:'pending'},{id:'q2',subject:'Cloison',message:'Remarque',status:'resolved'}]}};
 const rows=sceneAdminRequests(scene);assert.equal(rows.length,3);assert.deepEqual(rows.map(s=>s.requestQuestionId),[undefined,'q1','q2']);
 assert.equal(questionAsRequest(scene.source_payload.questions[0]).text,'Sol\n\nCouleur ?');assert.equal(rows[0].source_payload.specialRequest.text,'Demande initiale');
});
test('treating a question preserves draft status, the other questions and the special request',async()=>{
 let scene={id:'s',status:'created',client_status:'draft',source_payload:{specialRequest:{text:'Autre demande'},questions:[{id:'q1',status:'pending'},{id:'q2',status:'pending'}]}};
 const code=readFileSync(new URL('../src/data/sceneStore.js',import.meta.url),'utf8');let start=code.indexOf('export async function markSceneSpecialRequestResolved');start+=7;const end=code.indexOf('\n}\n',start)+2;
 const api=vm.createContext({supabase:null,readLocalScenes:()=>[scene],writeLocalScenes:rows=>{scene=rows[0];}});vm.runInContext(code.slice(start,end),api);
 await api.markSceneSpecialRequestResolved({...scene,requestQuestionId:'q1'});
 assert.equal(scene.status,'created');assert.equal(scene.client_status,'draft');assert.equal(scene.source_payload.exhibitor_view_only,undefined);assert.equal(scene.source_payload.questions[0].status,'resolved');assert.equal(scene.source_payload.questions[1].status,'pending');assert.equal(scene.source_payload.specialRequest.text,'Autre demande');
});
