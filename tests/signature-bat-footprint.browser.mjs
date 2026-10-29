import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';

const source = await readFile('src/App.jsx', 'utf8');
const appId = resolve('src/__signature-bat-floor-app.jsx');
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'signature-bat-floor',
  resolveId(id) { if (id === '/src/__signature-bat-floor-app.jsx') return appId; },
  load(id) { if (id === appId) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export { withTechnicalOptionsMarker, signatureArchFootprintDimensions };'); },
  configureServer(vite) { vite.middlewares.use((req, res, next) => {
    if (req.url !== '/__signature-bat-floor__') return next();
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><style>body{margin:0}</style><script type="module">import * as bat from "/src/technicalExport.js";import * as app from "/src/__signature-bat-floor-app.jsx";window.floorApi={...bat,...app};</script>');
  }); },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1800, height: 1280 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__signature-bat-floor__`);
  await page.waitForFunction(() => window.floorApi);
  const result = await page.evaluate(async () => {
    const api = window.floorApi;
    const width = 6, depth = 4, color = '#2874ad';
    const arch = { id:'arch', type:'arche-signature', label:'Arche Signature 2m', modelSize:[1.2,3.5,2], x:-1.2,z:-.7,rotation:0,options:{signatureArchColorHex:color,signatureArchColorName:'Bleu'} };
    const scene = { offer:'Signature',dimensions:{width,depth},layout:'back',options:{carpetFootprintEnabled:false} };
    const input = items => ({width,depth,layout:'back',items:api.withTechnicalOptionsMarker(items,scene,[]),catalog:[]});
    const squareCount = svg => [...svg.querySelectorAll('rect[fill="#eee5d6"]')].filter(rect => +rect.getAttribute('width')>30 && +rect.getAttribute('height')>30).length;
    const footprint = svg => [...svg.querySelectorAll('rect[fill="'+color+'"]')].find(rect => !rect.closest('[data-bat-id]') && +rect.getAttribute('height')>30);
    const inspect = (svg, expected) => {
      document.body.replaceChildren(svg);
      const rect = footprint(svg), floor = svg.querySelector('rect[fill="#f4efe5"]');
      if (!rect) throw new Error('Missing arch carpet footprint');
      const scale = +floor.getAttribute('width') / width;
      const center = new DOMPoint().matrixTransform(rect.getCTM());
      return {squareCount:squareCount(svg),width:+rect.getAttribute('width')/scale,depth:+rect.getAttribute('height')/scale,
        x:(center.x-Number(floor.getAttribute('x')))/scale-width/2,z:(center.y-Number(floor.getAttribute('y')))/scale-depth/2,
        expected,legend:svg.textContent.includes('Empreinte sous arche'),color:rect.getAttribute('fill')};
    };
    const marked = input([arch]);
    const pages = await api.createTechnicalPlanSvgPages(marked);
    const standard = inspect(pages[0], marked.items.at(-1).sourceFloor.footprints[0]);
    const preview = api.renderTechnicalPlanCanvas(marked);
    const floorRect = pages[0].querySelector('rect[fill="#f4efe5"]');
    const scale = +floorRect.getAttribute('width') / width;
    const pixel = preview.getContext('2d').getImageData(
      Math.round((+floorRect.getAttribute('x')+(arch.x+width/2)*scale)*2.75),
      Math.round((+floorRect.getAttribute('y')+(depth+.25)*scale)*2.75),1,1).data;
    const grouped = { ...arch,id:'grouped',isGroup:true,groupSize:[5,4,3],children:[
      {id:'totem',type:'totem',modelSize:[1,3,2],x:.5,z:0},
      {id:'small',type:'small',modelSize:[.2,1,.2],x:-.8,z:0},
    ]};
    const variants = [];
    for (const item of [{...arch,modelSize:[1.4,3.5,3]},grouped,{...grouped,rotation:90}]) {
      const data = input([item]), svg = (await api.createTechnicalPlanSvgPages(data))[0];
      variants.push({...inspect(svg,data.items.at(-1).sourceFloor.footprints[0]),threeDimensions:api.signatureArchFootprintDimensions(item,depth)});
    }
    const absent = (await api.createTechnicalPlanSvgPages(input([])))[0];
    const otherPacks = [];
    for (const offer of ['Confort','Prestige','Équipé']) {
      const items = api.withTechnicalOptionsMarker([],{...scene,offer,options:{carpetFootprintEnabled:true}},[]);
      otherPacks.push(squareCount((await api.createTechnicalPlanSvgPages({width,depth,layout:'back',items,catalog:[]}))[0]));
    }
    document.body.replaceChildren(pages[0]);
    const pdf = await api.createTechnicalPlanBlob(marked);
    return {standard,variants,previewPixel:Array.from(pixel),absent:squareCount(absent),otherPacks,pdf:Array.from(new Uint8Array(await pdf.arrayBuffer()))};
  });
  for (const entry of [result.standard, ...result.variants]) {
    assert.equal(entry.squareCount, 0);
    for (const key of ['width','depth','x','z']) assert.ok(Math.abs(entry[key]-entry.expected[key])<.0001, `${key}: ${JSON.stringify(entry)}`);
    assert.equal(entry.color, '#2874ad');
    assert.equal(entry.legend, true);
    if (entry.threeDimensions) {
      assert.ok(Math.abs(entry.width-entry.threeDimensions.width)<.0001);
      assert.ok(Math.abs(entry.depth-entry.threeDimensions.depth)<.0001);
    }
  }
  assert.equal(result.standard.depth, 4.5);
  assert.deepEqual(result.previewPixel, [40,116,173,255], 'The legacy PNG preview also uses the arch footprint color and 50 cm overhang');
  assert.equal(result.absent, 0, 'Signature without an arch has no square footprint');
  assert.deepEqual(result.otherPacks, [1,1,1]);
  const pdf = await PDFDocument.load(Uint8Array.from(result.pdf));
  assert.ok(Math.abs(pdf.getPage(0).getWidth()/pdf.getPage(0).getHeight()-420/297)<.001);
  await page.screenshot({path:'/tmp/standing-signature-bat-footprint.png'});
  assert.deepEqual(errors, []);
  console.log('Signature BAT footprint: real 3D bounds/color/position, grouped and rotated arches, 50 cm overhang, no-arch state, unchanged other packs, PNG and vector A3 PDF OK.');
} finally { await browser?.close(); await server.close(); }
