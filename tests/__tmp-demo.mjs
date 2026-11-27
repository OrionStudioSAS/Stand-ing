// Temporary local demo: configurator on a test stand with real object-bank assets (no auth, no save).
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const appId = resolve('src/__demo-app.jsx');
const pageId = resolve('src/__demo-page.jsx');
const storeId = resolve('src/data/sceneStore.js');
const bank = JSON.parse(await readFile(process.argv[2], 'utf8'));
const byType = Object.fromEntries(bank.map((row) => [row.type, row]));
const place = (type, id, x, z, extra = {}) => ({ id, type, label: byType[type].label, x, z, rotation: 0, modelUrl: byType[type].model_url, dimensions: byType[type].dimensions, ...extra });
const included = { included: true, priceMode: 'included', basePresetId: 'demo-pack' };
const scene = { id: 'demo-local', offer: 'Équipé', salon: 'Démo locale', project_name: 'Stand démo',
  dimensions: { width: 6, depth: 3 }, layout: 'back',
  items: [
    place('asset-tv-65-sur-pied-mqpmnc7o', 't65', -1.8, -0.6),
    place('asset-borne-tactile-46-mqt74yeo', 'b46', 0, -0.4),
    place('asset-tv-55-sur-pied-mr9b9r0x', 't55', 1.2, -0.6),
    place('asset-mur-led-vertical-mvghg3f0', 'mlv', 2.5, -1.0),
    place('asset-tete-de-cloison-siae-gauche-1-muy54tuv', 'head-left', -1.3, 1.3),
    place('asset-podium-blanc-50x50x50cm-ht-mqpnkc2a', 'stool-1', -0.6, 0.8, included),
    place('asset-podium-blanc-50x50x50cm-ht-mqpnkc2a', 'stool-2', 0.6, 0.8, included),
  ],
  client_status: 'draft', options: { ledRailsEnabled: false, wallCovers: { back: { enabled: true } } }, source_payload: {} };
const harness = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import * as api from '/src/__demo-app.jsx';
localStorage.setItem('standing-config-intro:demo-local', 'started');
localStorage.setItem('standing-config-tutorial:demo-local', 'done');
createRoot(document.getElementById('root')).render(<api.ConfiguratorApp initialScene={${JSON.stringify(scene)}} isAdminViewer />);
`;
const store = `export * from '/src/data/sceneStore.js?demo-original';
export async function listObjectBank() { return ${JSON.stringify(bank)}; }
export async function saveScene(scene) { return scene; }
`;
const server = await createServer({ server: { host: '127.0.0.1', port: 5180, strictPort: true }, logLevel: 'error', plugins: [{
  name: 'local-demo',
  resolveId(id) { if (id === '/src/__demo-app.jsx') return appId; if (id === '/src/__demo-page.jsx') return pageId; },
  async load(id) {
    if (id === appId) return (await readFile('src/App.jsx', 'utf8')).replace("createRoot(document.getElementById('root')).render(<App />);", 'export { ConfiguratorApp };');
    if (id === pageId) return harness;
    if (id === storeId) return store;
  },
  configureServer(vite) { vite.middlewares.use((req, res, next) => {
    if (req.url.split('?')[0] !== '/demo') return next();
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Démo locale</title></head><body><div id="root"></div><script type="module" src="/src/__demo-page.jsx"></script></body></html>');
  }); },
}] });
await server.listen();
console.log('demo ready http://127.0.0.1:5180/demo');
