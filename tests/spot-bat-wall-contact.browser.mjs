import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';

const spotSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20"><rect data-contact="" width="100" height="2" fill="#111"/><rect x="10" y="2" width="15" height="18" fill="#139b48"/><rect x="75" y="2" width="15" height="18" fill="#139b48"/></svg>';
const electricSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="10" fill="#ffcc22"/></svg>';
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'spot-wall-contact', configureServer(vite) { vite.middlewares.use((req, res, next) => {
    if (req.url === '/__spot-contact.svg' || req.url === '/__spot-electric.svg') {
      res.setHeader('Content-Type', 'image/svg+xml'); res.end(req.url === '/__spot-contact.svg' ? spotSvg : electricSvg);
    } else if (req.url === '/__spot-contact__') {
      res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><style>body{margin:0}</style><script type="module">import * as api from "/src/technicalExport.js";window.bat=api;</script>');
    } else next();
  }); },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1800, height: 1280 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__spot-contact__`);
  await page.waitForFunction(() => window.bat);
  const results = await page.evaluate(async () => {
    const width = 6, depth = 4, results = [];
    const base = { id:'spot',type:'rail-led',label:'Rail LED 3 spots',isWallItem:true,autoLedRail:true,modelSize:[.8,.14,.24],x:.35,dimensions:{category:'Électricité',batPictoUrl:'/__spot-contact.svg'} };
    const cases = ['back','left','right'].map(wall => ({ item:{...base,wall},axis:wall==='back'?'y':'x',side:wall==='right'?-1:1 }));
    for (const orientation of ['x','z']) for (const side of [-1,1]) cases.push({
      item:{...base,wall:'object-wall:reserve',wallSide:side,wallSurface:{orientation,normalAxis:-.5,centerAxis:0,length:2}},axis:orientation==='x'?'y':'x',side,
    });
    for (const testCase of cases) {
      const {item,axis,side} = testCase;
      const items = [item];
      if (item.wallSurface) items.unshift({ id:'panel',type:'cloison',label:'Cloison réserve',modelSize:item.wallSurface.orientation==='x'?[2,2.5,.06]:[.06,2.5,2],x:item.wallSurface.orientation==='z'?-.5:0,z:item.wallSurface.orientation==='x'?-.5:0 });
      const input = {width,depth,layout:'u',items,catalog:[]};
      const before = JSON.stringify(items);
      const pages = await window.bat.createTechnicalPlanSvgPages(input);
      document.body.replaceChildren(pages[0]);
      const contact = pages[0].querySelector('[data-bat-id="spot"] [data-contact]').getBoundingClientRect();
      const floor = pages[0].querySelector('rect[fill="#f4efe5"]').getBoundingClientRect();
      const scale = floor.width/width;
      const wallFace = item.wallSurface
        ? (axis==='y'?floor.y+depth/2*scale:floor.x+width/2*scale)+(-.5+side*.03)*scale
        : item.wall==='back'?floor.top+Math.max(8,scale*.06):item.wall==='left'?floor.left+Math.max(8,scale*.06):floor.right-Math.max(8,scale*.06);
      const edge = axis==='y'?(side>0?contact.top:contact.bottom):(side>0?contact.left:contact.right);
      const cotations = [...pages[0].querySelectorAll('text')].filter(node=>/^E\d+ ·/.test(node.textContent));
      results.push({name:item.wallSurface?item.wallSurface.orientation+side:item.wall,gap:Math.abs(edge-wallFace),cotations:cotations.length,unchanged:before===JSON.stringify(items),raster:pages[0].querySelectorAll('image').length});
    }
    const overlay = {...base.dimensions,batElectricalPictoUrl:'/__spot-electric.svg',batElectricalPictoY:-1};
    const extraCases = [
      {item:{...base,wall:'back',dimensions:overlay},expected:1},
      {item:{...base,type:'spot-led',label:'Spot LED Blanc 30W',autoLedRail:false,wall:'left'},expected:1},
      {item:{...base,id:'tv',type:'screen',label:'TV 43 pouces',autoLedRail:false,wall:'back',dimensions:overlay},expected:2},
      {item:{id:'power',type:'power',label:'Alimentation',x:0,z:0,modelSize:[.2,.1,.2],dimensions:{category:'Électricité',batPictoUrl:'/__spot-electric.svg'}},expected:2},
    ];
    for (const {item,expected} of extraCases) {
      const svg = (await window.bat.createTechnicalPlanSvgPages({width,depth,layout:'u',items:[item],catalog:[]}))[0];
      results.push({name:item.id+' overlay/control',expected,cotations:[...svg.querySelectorAll('text')].filter(node=>/^E\d+ ·/.test(node.textContent)).length});
    }
    const moved = (await window.bat.createTechnicalPlanSvgPages({width,depth,layout:'u',items:[{...base,wall:'back'}],catalog:[],batEdits:{items:{spot:{dy:.05}}}}))[0];
    results.push({name:'admin moves spot away from wall',expected:2,cotations:[...moved.querySelectorAll('text')].filter(node=>/^E\d+ ·/.test(node.textContent)).length});
    const pdf = await window.bat.createTechnicalPlanBlob({width,depth,layout:'u',items:[{...base,wall:'back'}],catalog:[]});
    return {cases:results,pdf:Array.from(new Uint8Array(await pdf.arrayBuffer()))};
  });
  for (const result of results.cases) {
    assert.equal(result.cotations,result.expected||1,JSON.stringify(result));
    if ('gap' in result) {
      assert.ok(result.gap<.05,JSON.stringify(result));
      assert.equal(result.unchanged,true);
      assert.equal(result.raster,0);
    }
  }
  const pdf = await PDFDocument.load(Uint8Array.from(results.pdf));
  assert.ok(Math.abs(pdf.getPage(0).getWidth()/pdf.getPage(0).getHeight()-420/297)<.001);
  await page.screenshot({path:'/tmp/standing-spot-bat-wall-contact.png'});
  assert.deepEqual(errors,[]);
  console.log('BAT spots: proportional SVGs touch back/left/right and both reserve wall faces, only along-wall electrical cotations, free power/TV unchanged, admin offsets respected, vector A3 PDF OK.');
} finally { await browser?.close(); await server.close(); }
