import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url).pathname;
const source = await readFile(`${root}src/App.jsx`, 'utf8');
const profiles = ['Signature', 'Équipé', 'Confort', 'Prestige'];
const assets = profiles.flatMap(pack => ['left', 'right'].map(side => ({ type: `${pack}-${side}`, label: `Tête de cloison ${pack === 'Signature' ? 'Signature' : pack === 'Équipé' ? 'SIAE' : 'SMCL'} ${side}`, is_active: true, dimensions: { packs: [pack], size: [.6, 2.5, .2] } })));
const art = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="546" height="2908"><defs><linearGradient id="g"><stop stop-color="#3764ab"/><stop offset=".5" stop-color="#4bbec3"/><stop offset="1" stop-color="#e2b568"/></linearGradient></defs><path fill="url(#g)" d="M0 0H546V2908H0Z"/></svg>');
const harness = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import*as api from'/src/__head-design-app.jsx';window.api=api;
const assets=${JSON.stringify(assets)},art=${JSON.stringify(art)};
function Test(){const[pack,setPack]=useState('Signature'),[visuals,setVisuals]=useState({}),[sides,setSides]=useState({left:true,right:true}),[name,setName]=useState('TEST JULIEN L 2'),[disabled,setDisabled]=useState(false),[open,setOpen]=useState(true),[error,setError]=useState(''),[key,setKey]=useState(0);window.headDesignState={visuals,sides,name};
const patch=(side,options)=>setVisuals(value=>api.patchPartitionHeadVisuals(value,side,options));const rule={includedCount:2,leftType:pack+'-left',rightType:pack+'-right',leftPrice:200,rightPrice:200};
return <><nav style={{position:'fixed',bottom:0,left:0,zIndex:99999,background:'white'}}>{${JSON.stringify(profiles)}.map(pack=><button key={pack} onClick={()=>{setPack(pack);setVisuals({});setSides({left:true,right:true});setOpen(true);setDisabled(false);setKey(n=>n+1)}}>Pack {pack}</button>)}<button onClick={()=>setDisabled(v=>!v)}>Lecture seule</button><button onClick={()=>{setVisuals(api.normalizePartitionHeadVisuals(JSON.parse(JSON.stringify(visuals))));setKey(n=>n+1);setOpen(true)}}>Reouvrir</button><button onClick={()=>setError('Import impossible. Réessayez.')}>Erreur</button></nav>
<main style={{width:360,maxWidth:'calc(100vw - 32px)',margin:'16px auto'}}><api.OptionAccordion className="head-section-accordion" title="Tête de cloison" subtitle={pack==='Signature'?'2 têtes · Partie haute · Partie basse':'2 têtes · Visuel · Informations'} ariaLabel="Tête de cloison" open={open} onToggle={()=>setOpen(v=>!v)} icon={<api.ConfiguratorOptionIcon src="/icons/tete_de_cloison.svg"/>}>
<api.PartitionHeadOptionCard key={key} rule={rule} sides={sides} isSignatureStand={pack==='Signature'} companyName={name} catalog={assets.map(asset=>api.assetToCatalogEntry(asset,assets))} salonLabel={pack} disabled={disabled} visualOptions={visuals} visualContext={{company:name,standNumber:'15',aisleNumber:'A',hall:'3',country:'FR'}} uploadState={{error}}
onChange={(side,selected)=>setSides(current=>({...current,[side]:selected}))} onCompanyName={setName} onDifferentVisuals={different=>setVisuals(value=>api.withPartitionHeadVisualMode(value,different))} onVisualOptions={patch}
onImage={(side,file,slot)=>{window.lastHeadFile={side,name:file.name,slot:slot?.id};patch(side,options=>slot?api.textureSlotPatch({options},slot,{imageUrl:art,imageName:file.name,visualPending:false}):{headMainImageUrl:art,headMainImageName:file.name,visualPending:false})}}
onResetImage={(side,slot)=>patch(side,options=>slot?api.textureSlotPatch({options},slot,{imageUrl:'',imageName:'',visualPending:false}):{headMainImageUrl:'',headMainImageName:'',visualPending:false})}/></api.OptionAccordion></main></>};createRoot(document.getElementById('root')).render(<Test/>);`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'head-options-design',
  resolveId(id) { if (id === '/src/__head-design-app.jsx') return `${root}src/__head-design-app.jsx`; if (id === '/src/__head-design-page.jsx') return `${root}src/__head-design-page.jsx`; },
  load(id) {
    if (id === `${root}src/__head-design-app.jsx`) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export {PartitionHeadOptionCard,OptionAccordion,ConfiguratorOptionIcon,assetToCatalogEntry,patchPartitionHeadVisuals,withPartitionHeadVisualMode,normalizePartitionHeadVisuals,textureSlotPatch};');
    if (id === `${root}src/__head-design-page.jsx`) return harness;
  },
  configureServer(vite) { vite.middlewares.use('/__head-design__', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__head-design-page.jsx"></script>'); }); },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 408, height: 1800 } });
  const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__head-design__`);
  const card = page.locator('.head-section-accordion');
  const top = card.getByRole('group', { name: 'Partie haute', exact: true });
  const bottom = card.getByRole('group', { name: 'Partie basse lumineuse', exact: true });
  const choice = (group, title) => group.getByRole('button', { name: new RegExp(title) });
  const mainUpload = () => card.getByLabel('Partie basse lumineuse', { exact: true }).filter({ has: page.locator('input[type=file]') });
  const upload = async (block, name) => block.locator('input[type=file]').setInputFiles({ name, mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="350"/>') });
  await top.waitFor(); await page.evaluate(() => document.fonts.ready);
  assert.equal(await card.locator('.head-front-preview').evaluate(el => el.offsetHeight), 252);
  assert.equal(await card.locator(':scope > button').evaluate(el => el.offsetHeight), 62);
  assert.match(await card.innerText(), /500 × 350 mm/);
  assert.match(await card.innerText(), /546 × 2908 mm/);
  assert.equal(await card.locator('.head-country-flag').count(), 0);
  await choice(bottom, 'Votre visuel').click();
  await mainUpload().getByRole('checkbox').check();
  assert.equal(await mainUpload().locator('input[type=file]').isDisabled(), true);
  assert.match(await card.innerText(), /nous vous le redemanderons/);
  await card.screenshot({ path: '/tmp/standing-head-pending.png' });
  await page.getByRole('button', { name: 'Reouvrir', exact: true }).click();
  assert.equal(await choice(bottom, 'Votre visuel').getAttribute('aria-pressed'), 'true');
  assert.equal(await mainUpload().getByRole('checkbox').isChecked(), true);
  await card.getByRole('button', { name: 'Différente par tête', exact: true }).click();
  const left = card.getByRole('tab', { name: /^Tête gauche/ }), right = card.getByRole('tab', { name: /^Tête droite/ });
  await right.click(); await choice(bottom, 'Visuel standard').click();
  assert.equal(await left.locator('small').innerText(), 'à compléter');
  assert.equal(await right.locator('svg').count(), 1);
  await card.screenshot({ path: '/tmp/standing-head-different-right.png' });
  await choice(bottom, 'Votre visuel').click();
  await left.click(); await choice(top, 'Votre logo').click();
  const topUpload = card.locator('.head-artwork-upload').first();
  await upload(topUpload, 'logo-societe.svg');
  await mainUpload().getByRole('checkbox').uncheck();
  await upload(mainUpload(), 'visuel-gauche.svg');
  assert.match(await card.locator('.head-options-footer').innerText(), /97 €/);
  assert.equal(await card.locator('.head-preview-heads img').count(), 2);
  assert.doesNotMatch(await card.innerText(), /Format conforme/, 'No unverified format validation is claimed');
  await card.screenshot({ path: '/tmp/standing-head-different-left.png' });
  const framing = topUpload.locator('.image-framing-controls'); await framing.locator('summary').click();
  await framing.locator('input[type=range]').fill('145'); await framing.locator('input[type=range]').press('ArrowRight');
  assert.equal(await page.evaluate(() => window.headDesignState.visuals.left.textureSlotValues['signature-head-top-28'].imageZoom), 1.5);
  await right.click();
  assert.equal(await choice(top, 'Nom & emplacement').getAttribute('aria-pressed'), 'true');
  assert.match(await right.innerText(), /à compléter/);
  await right.press('ArrowLeft'); assert.equal(await left.getAttribute('aria-selected'), 'true');
  await page.getByRole('button', { name: 'Lecture seule', exact: true }).click();
  assert.equal(await card.locator('.head-art-choice:not(:disabled), .head-configuration-mode button:not(:disabled), input:not(:disabled)').count(), 0);
  await right.click(); assert.equal(await right.getAttribute('aria-selected'), 'true', 'Read-only users can inspect either head');
  await page.getByRole('button', { name: 'Lecture seule', exact: true }).click();
  await card.getByRole('button', { name: 'Même configuration', exact: true }).click();
  assert.equal(await card.locator('.head-side-tabs').count(), 0);
  await choice(top, 'Nom & emplacement').click();
  assert.equal(await page.evaluate(() => window.headDesignState.visuals.left.textureSlotValues['signature-head-top-28'].imageUrl), '');
  assert.match(await card.locator('.head-options-footer').innerText(), /0 €/);
  assert.equal(await card.getByRole('button', { name: 'Appliquer', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Tête de cloison', exact: true }).click();
  assert.equal(await card.locator('.head-quickview').count(), 0);
  await page.getByRole('button', { name: 'Tête de cloison', exact: true }).click();
  assert.equal(await choice(top, 'Nom & emplacement').getAttribute('aria-pressed'), 'true');

  for (const pack of ['Équipé', 'Confort', 'Prestige']) {
    await page.getByRole('button', { name: `Pack ${pack}`, exact: true }).click();
    assert.equal(await top.count(), 0, pack);
    assert.equal(await bottom.count(), 0, pack);
    assert.equal(await card.locator('.head-artwork-upload').count(), 1);
    assert.equal(await card.locator('.head-country-flag').count(), pack === 'Équipé' ? 2 : 0, pack);
    assert.doesNotMatch(await card.innerText(), /lumineuse|97 €|rétroéclairée/, pack);
    assert.match(await card.innerText(), pack === 'Équipé' ? /474 × 296 mm/ : /947 × 593 mm/);
    await upload(card.locator('.head-artwork-upload'), `${pack}.svg`);
    assert.equal(await page.evaluate(() => window.headDesignState.visuals.right.headMainImageName), `${pack}.svg`);
    await card.getByRole('button', { name: 'Différente par tête', exact: true }).click();
    await card.getByRole('tab', { name: /^Tête droite/ }).click();
    await upload(card.locator('.head-artwork-upload'), `${pack}-droite.svg`);
    assert.equal(await page.evaluate(() => window.headDesignState.visuals.left.headMainImageName), `${pack}.svg`);
    assert.equal(await page.evaluate(() => window.headDesignState.visuals.right.headMainImageName), `${pack}-droite.svg`);
    await card.screenshot({ path: `/tmp/standing-head-${pack === 'Équipé' ? 'equipped' : pack.toLowerCase()}.png` });
    await card.getByRole('button', { name: /Supprimer les têtes de cloison/ }).click();
    assert.equal(await card.locator('.head-front-preview').count(), 0);
    await card.locator('.partition-head-choice-grid button').first().click();
    assert.equal(await card.locator('.head-configuration-mode').count(), 0);
  }
  await page.getByRole('button', { name: 'Pack Signature', exact: true }).click();
  await card.getByRole('button', { name: 'Différente par tête', exact: true }).click();
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 1800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px`);
    const bounds = await card.locator('.head-art-choices button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().width));
    assert.ok(bounds.every(width => width > 90));
  }
  await page.getByRole('button', { name: 'Erreur', exact: true }).click();
  assert.equal(await card.getByRole('alert').innerText(), 'Import impossible. Réessayez.');
  assert.deepEqual(errors, []);
  console.log('Head quick-view: Signature upper/lower modes, shared/independent tabs, pending/ready/missing, actual formats, single logo fee, image framing, Equipped flag, SMCL without flag, removal, read-only/mobile and reopen OK');
} finally { await browser?.close(); await server.close(); }
