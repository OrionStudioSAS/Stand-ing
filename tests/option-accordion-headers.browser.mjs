import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url).pathname;
const source = await readFile(`${root}src/App.jsx`, 'utf8');
const harness = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{OptionsStepPanel}from'/src/__accordion-app.jsx';
const closed=Object.fromEntries(['moquette','coton','plancher','led','reserve','tete','arche','enseigne','comptoir'].map(key=>[key,false]));
function Test(){const[pack,setPack]=useState('Signature'),[open,setOpen]=useState(closed),[depth,setDepth]=useState(4);return <><nav style={{position:'fixed',bottom:0,left:0,zIndex:9999,background:'white'}}>{['Signature','Équipé','Confort','Prestige','Autre'].map(pack=><button key={pack} onClick={()=>{setPack(pack);setOpen(closed);setDepth(4)}}>Pack {pack}</button>)}<button onClick={()=>{setDepth(2);setOpen(closed)}}>Arche indisponible</button></nav><main style={{width:360,maxWidth:'calc(100vw - 24px)',margin:'16px auto',display:'grid',gap:14}}><OptionsStepPanel activeStep={2} area={20} standWidth={5} standDepth={depth} layout="u" openOptions={open} toggleOption={key=>setOpen(value=>({...value,[key]:!value[key]}))} salonLabel={pack} catalog={[]} isSignatureStand={pack==='Signature'} isPrestigeStand={pack==='Prestige'} isAdminViewer hasIncludedObjects partitionHeadSides={{left:true,right:true}} onOpenShop={()=>{}}/></main></>};createRoot(document.getElementById('root')).render(<Test/>);`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'accordion-headers-test',
  resolveId(id) { if (id === '/src/__accordion-app.jsx') return `${root}src/__accordion-app.jsx`; if (id === '/src/__accordion-page.jsx') return `${root}src/__accordion-page.jsx`; },
  load(id) {
    if (id === `${root}src/__accordion-app.jsx`) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export {OptionsStepPanel};');
    if (id === `${root}src/__accordion-page.jsx`) return harness;
  },
  configureServer(vite) { vite.middlewares.use('/__accordion-headers__', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__accordion-page.jsx"></script>'); }); },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 408, height: 1600 }, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__accordion-headers__`);
  const sections = page.locator('.option-accordion');
  await sections.first().waitFor(); await page.evaluate(() => document.fonts.ready);
  const metrics = () => sections.evaluateAll(elements => elements.map(section => {
    const button = section.querySelector(':scope > button'), title = button.querySelector('.option-accordion-title'), subtitle = button.querySelector('.option-accordion-subtitle'), toggle = button.querySelector('.option-accordion-toggle'), arrow = toggle.querySelector('svg'), icon = button.querySelector('.option-accordion-icon');
    const font = element => { const css = getComputedStyle(element); return [css.fontFamily, css.fontSize, css.fontWeight, css.lineHeight]; };
    const rect = element => { const r = element.getBoundingClientRect(); return { left:r.left, right:r.right, width:r.width, height:r.height }; };
    return { title:font(title),subtitle:subtitle?font(subtitle):null,button:rect(button),titleRect:rect(title),icon:rect(icon),toggle:rect(toggle),toggleColor:getComputedStyle(toggle).backgroundColor,background:getComputedStyle(button).backgroundColor,arrow:arrow.getAttribute('class'),transform:getComputedStyle(arrow).transform,expanded:button.getAttribute('aria-expanded') };
  }));
  let expectedTitle, expectedSubtitle;
  for (const pack of ['Signature', 'Équipé', 'Confort', 'Prestige', 'Autre']) {
    await page.getByRole('button', { name:`Pack ${pack}`, exact:true }).click();
    for (const width of [408, 320, 768]) {
      await page.setViewportSize({ width, height:1600 });
      const values = await metrics();
      expectedTitle ||= values[0].title; expectedSubtitle ||= values.find(value=>value.subtitle).subtitle;
      for (const value of values) {
        assert.deepEqual(value.title, expectedTitle, `${pack}: every title has the same typography`);
        assert.equal(value.title[1], '14px'); assert.equal(value.title[2], '600');
        if (value.subtitle) { assert.deepEqual(value.subtitle, expectedSubtitle); assert.equal(value.subtitle[1], '11px'); assert.equal(value.subtitle[2], '400'); }
        assert.equal(value.icon.width, 26); assert.equal(value.icon.height, 26); assert.equal(value.toggle.width, 26); assert.equal(value.toggle.height, 26);
        assert.equal(value.titleRect.left, values[0].titleRect.left, 'All titles align, including the technical-floor SVG icon');
        assert.ok(value.titleRect.right <= value.toggle.left - 8); assert.equal(value.toggleColor, values[0].toggleColor);
        assert.equal(value.background, 'rgb(31, 67, 120)'); assert.match(value.arrow, /chevron-down/); assert.equal(value.expanded, 'false');
        assert.equal(value.transform, 'none'); assert.ok(value.button.height >= 62);
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), true, `${pack} ${width}px`);
    }
    await page.setViewportSize({width:408,height:1600});
    if (pack === 'Signature') await page.locator('main').screenshot({path:'/tmp/standing-harmonized-step-two.png'});
    for (let i=0; i<await sections.count(); i++) {
      const section=sections.nth(i), header=section.locator(':scope > button');
      await header.click();
      assert.equal(await header.getAttribute('aria-expanded'),'true');
      const arrow=header.locator('.option-accordion-toggle > svg');
      assert.equal(await arrow.evaluate(el=>getComputedStyle(el).transform),'matrix(-1, 0, 0, -1, 0, 0)');
      assert.deepEqual((await metrics())[i].title,expectedTitle);
      await header.press('Enter'); assert.equal(await header.getAttribute('aria-expanded'),'false');
      await header.press('Space'); assert.equal(await header.getAttribute('aria-expanded'),'true');
      await header.click();
    }
  }
  await page.getByRole('button',{name:'Pack Signature',exact:true}).click();
  await page.getByRole('button',{name:'Arche indisponible',exact:true}).click();
  const arch=page.locator('.signature-arch-accordion');
  assert.match(await arch.locator(':scope > button').innerText(),/Non disponible/);
  assert.equal(await arch.locator('.signature-arch-title > small').evaluate(el=>getComputedStyle(el).fontSize),'9px','Availability badges keep their separate small-badge style');
  await arch.locator(':scope > button').click();
  assert.match(await arch.locator('.option-accordion-toggle > svg').getAttribute('class'),/chevron-down/);
  assert.deepEqual(errors,[]);
  console.log('Shared step-2 headers: all packs and sections, identical typography, aligned icons/titles, circular chevron open/close, badges, Enter/Space and responsive 320/408/768px OK');
} finally { await browser?.close(); await server.close(); }
