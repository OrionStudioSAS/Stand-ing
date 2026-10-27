import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isDeploymentAssetError } from '../src/deploymentAssets.js';

test('recognizes missing deployment modules across browsers without masking unrelated failures', () => {
  for (const message of ['Failed to fetch dynamically imported module: /assets/jspdf-old.js', 'Importing a module script failed.', 'error loading dynamically imported module', 'Unable to preload CSS for /assets/index-old.css', 'Loading chunk 12 failed.']) {
    assert.equal(isDeploymentAssetError(new TypeError(message)), true, message);
  }
  for (const message of ['permission denied for table scene_bat_edits', 'Impossible de charger un picto BAT', 'Failed to fetch', 'Scene not found']) {
    assert.equal(isDeploymentAssetError(new Error(message)), false, message);
  }
  assert.equal(isDeploymentAssetError(null), false);
});

test('HTML routes revalidate without applying HTML cache rules to hashed assets', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  for (const route of ['/', '/index.html', '/admin', '/admin/:path*']) {
    assert.ok(config.headers.find(rule => rule.source === route)?.headers.some(header => header.key === 'Cache-Control' && header.value === 'no-cache'));
  }
  assert.ok(config.headers.every(rule => !rule.source.includes('assets')));
});
