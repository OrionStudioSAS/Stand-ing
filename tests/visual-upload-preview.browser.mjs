import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { PDFDocument, rgb } from 'pdf-lib';

const appId = resolve('src/__preview-upload-app.jsx');
const pageId = resolve('src/__preview-upload-page.jsx');
const appSource = await readFile('src/App.jsx', 'utf8');
const scene = { id: 'preview-upload', offer: 'Signature', project_name: 'Aperçus', layout: 'back', dimensions: { width: 5, depth: 4 },
  items: [{ id: 'arch', type: 'arche-signature', label: 'Arche Signature', x: 0, z: -1,
    modelUrl: '/__preview-arch.obj', materialUrl: '/__preview-arch.mtl', dimensions: { size: [1, 3, 2] }, options: { signatureBaseKey: 'arche' } }],
  options: { ledRailsEnabled: false }, source_payload: {} };
const harness = `import React from 'react'; import { createRoot } from 'react-dom/client';
  import { ConfiguratorApp } from '/src/__preview-upload-app.jsx';
  const scene = ${JSON.stringify(scene)};
  localStorage.setItem('standing-config-intro:' + scene.id, 'started');
  localStorage.setItem('standing-config-tutorial:' + scene.id, 'done');
  const originalFetch = window.fetch.bind(window);
  window.fetch = (url, options) => {
    if (url !== '/__fake-hd__/uploads/production-file') return originalFetch(url, options);
    window.hdFile = options.body.get('file').name;
    return new Promise(resolve => { window.finishHD = () => resolve(new Response('{"ok":true}')); });
  };
  createRoot(document.getElementById('root')).render(<ConfiguratorApp initialScene={scene} isAdminViewer />);
`;
const storageMock = `
const saved = new Map();
export const supabase = {
  auth: { getSession: async () => ({ data: { session: { access_token: 'fixture' } } }) },
  storage: { from: () => ({
    upload: (path, file) => new Promise(resolve => {
      window.finishStorage = (fail = false) => {
        if (fail) return resolve({ error: new Error('Envoi interrompu') });
        const reader = new FileReader();
        reader.onload = () => { saved.set(path, reader.result); resolve({ error: null }); };
        reader.readAsDataURL(file);
      };
    }),
    getPublicUrl: path => ({ data: { publicUrl: saved.get(path) } }),
  }) },
};
`;
const server = await createServer({ logLevel: 'error', define: { 'import.meta.env.VITE_SFTP_GATEWAY_URL': '"/__fake-hd__"' },
  server: { host: '127.0.0.1', port: 0 }, plugins: [{
    name: 'visual-upload-preview',
    resolveId(id) {
      if (id === '/src/__preview-upload-app.jsx') return appId;
      if (id === '/src/__preview-upload-page.jsx') return pageId;
    },
    load(id) {
      if (id === appId) return appSource.replace("createRoot(document.getElementById('root')).render(<App />);", 'export { ConfiguratorApp };')
        .replace('  const texture = previewTexture || genericTexture;', '  window.bannerPreviewTexture = previewTexture;\n  const texture = previewTexture || genericTexture;')
        .replaceAll('  const textureSlotImages = useTextureSlotImages(item);', '  const textureSlotImages = useTextureSlotImages(item);\n  if (item.id === "arch") window.archPreviewImage = textureSlotImages["signature-arch-led-5"];');
      if (id === pageId) return harness;
      if (id === resolve('src/data/supabaseClient.js')) return storageMock;
      if (id === resolve('src/data/sceneStore.js')) return `export * from '/src/data/sceneStore.js?upload-preview-original';
        export async function listObjectBank() { return []; }
        export async function saveScene(scene) { window.savedScene = structuredClone(scene); return scene; }`;
    },
    configureServer(vite) {
      vite.middlewares.use('/__preview-upload__', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__preview-upload-page.jsx"></script>'); });
      vite.middlewares.use('/__preview-arch.obj', (_req, res) => { res.setHeader('Content-Type', 'text/plain'); res.end('v -0.5 0 0\nv 0.5 0 0\nv 0.5 3 0\nv -0.5 3 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nusemtl LED_5500k#5\nf 1/1 2/2 3/3 4/4\n'); });
      vite.middlewares.use('/__preview-arch.mtl', (_req, res) => { res.setHeader('Content-Type', 'text/plain'); res.end('newmtl LED_5500k#5\nKd 0.95 0.95 0.95\n'); });
    },
  }],
});

let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__preview-upload__`);
  const pdf = await PDFDocument.create();
  pdf.addPage([600, 320]).drawRectangle({ x: 0, y: 0, width: 600, height: 320, color: rgb(0, .7, .3) });
  const bannerFile = { name: 'banner.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
  const archFile = { name: 'arch.svg', mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="300"><rect width="100" height="300" fill="#ef3914"/></svg>') };

  await page.getByRole('button', { name: 'Cloison', exact: true }).click();
  const banner = page.locator('.wall-cover-row input[type=file]').first();
  const bannerThumb = page.locator('.wall-cover-row .wall-cover-preview-button img').first();
  await banner.setInputFiles(bannerFile);
  await page.waitForFunction(() => window.bannerPreviewTexture?.image && window.finishStorage);
  const localBanner = await bannerThumb.getAttribute('src');
  assert.match(localBanner, /^blob:/);
  assert.equal(await page.evaluate(() => Boolean(window.savedScene?.options.wallCovers.back)), false, 'Temporary cover does not enter the scene save');
  await page.evaluate(() => window.finishStorage());
  await page.waitForFunction(() => window.hdFile === 'banner.pdf');
  assert.equal(await bannerThumb.getAttribute('src'), localBanner, 'The banner is already visible while HD is blocked');
  await page.evaluate(() => window.finishHD());
  await page.waitForFunction(() => window.savedScene?.options.wallCovers.back?.previewName === 'banner.pdf');
  const storedBanner = await bannerThumb.getAttribute('src');
  assert.match(storedBanner, /^data:image\/jpeg/);

  await page.getByRole('button', { name: 'Arche', exact: true }).click();
  const arch = page.getByLabel('Importer — Visuel lumineux façade', { exact: true });
  const archThumb = page.getByRole('img', { name: 'Visuel lumineux façade', exact: true });
  await arch.setInputFiles(archFile);
  await page.waitForFunction(() => window.archPreviewImage?.src.startsWith('blob:'));
  assert.match(await archThumb.getAttribute('src'), /^blob:/);
  assert.equal(await page.evaluate(() => Boolean(window.savedScene.items[0].options.textureSlotValues?.['signature-arch-led-5'])), false);
  await page.evaluate(() => window.finishStorage());
  await page.waitForFunction(() => window.hdFile === 'arch.svg');
  assert.match(await archThumb.getAttribute('src'), /^blob:/);
  await page.evaluate(() => window.finishHD());
  await page.waitForFunction(() => window.savedScene?.items[0].options.textureSlotValues?.['signature-arch-led-5']?.imageName === 'arch.svg');
  assert.match(await archThumb.getAttribute('src'), /^data:image\/jpeg/);

  await page.getByRole('button', { name: 'Cloison', exact: true }).click();
  await banner.setInputFiles({ ...bannerFile, name: 'replacement.pdf' });
  await page.waitForFunction(() => document.querySelector('.wall-cover-preview-button img')?.src.startsWith('blob:'));
  await page.evaluate(() => window.finishStorage(true));
  await page.getByRole('alert').getByText('Envoi interrompu').waitFor();
  assert.equal(await bannerThumb.getAttribute('src'), storedBanner, 'Failed replacement restores the last saved image');
  assert.equal(await page.evaluate(() => JSON.stringify(window.savedScene).includes('blob:')), false);
  assert.deepEqual(errors, []);
  console.log('Artwork upload: banner and arch previews render before storage/HD completion, only stable URLs are saved, failed replacement rolls back');
} finally {
  await browser?.close();
  await server.close();
}
