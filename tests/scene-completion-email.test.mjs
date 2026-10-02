import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const source = readFileSync(new URL('../supabase/functions/scene-completion-email/index.ts', import.meta.url), 'utf8');
const compiled = transformSync(source.replace(/^import .*;\n/gm, ''), { loader: 'ts', format: 'cjs' }).code;
const api = vm.createContext({ Deno: { serve() {} }, console });
vm.runInContext(compiled, api);

test('request confirmation mentions a BDC only when attached', () => {
  const input = { mode: 'special_request_received', clientName: 'Marie', standName: 'Stand 12', eventName: 'SMCL', offerName: 'Confort', sceneUrl: 'https://example.com', specialRequest: 'Une remarque' };
  const withOrder = api.buildEmailContent({ ...input, hasPurchaseOrder: true });
  const withoutOrder = api.buildEmailContent({ ...input, hasPurchaseOrder: false });
  assert.match(withOrder.html, /bon de commande est joint/);
  assert.match(withOrder.text, /bon de commande est joint/);
  assert.doesNotMatch(withoutOrder.html, /bon de commande est joint/);
  assert.doesNotMatch(withoutOrder.text, /bon de commande est joint/);
});

test('admin request notification contains the request and escapes HTML', () => {
  const html = api.adminNotificationEmailHtml({
    clientName: 'Marie', toEmail: 'client@example.com', standName: 'Stand 12',
    eventName: 'SMCL', offerName: 'Confort', sceneUrl: 'https://example.com',
    mode: 'special_request_received', specialRequest: '<script>alert(1)</script>',
    hasTechnicalPlan: false, hasPurchaseOrder: false,
  });
  assert.match(html, /Nouvelle demande particulière/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(source, /mode === 'special_request_received'/);
});
