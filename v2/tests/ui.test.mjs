// Clicks through the dashboard in a real browser, in demo mode and against
// the Supabase data source with a fake client (fake-supabase.js) that serves
// table dumps. Usage: node v2/tests/ui.test.mjs <dump-dir> [screenshot-dir]
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [dump, shots] = process.argv.slice(2);
if (shots) mkdirSync(shots, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer((req, res) => {
  const path = join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!existsSync(path)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[extname(path)] || 'text/plain' });
  res.end(readFileSync(path));
}).listen(0);
const base = `http://localhost:${server.address().port}/v2/`;

let failures = 0;
const check = (cond, label) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failures++; };
const browser = await chromium.launch();

async function page() {
  const p = await browser.newPage({ viewport: { width: 400, height: 860 } });
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ contentType: 'text/javascript', body: readFileSync(join(root, 'v2/tests/fake-supabase.js')) }));
  await p.route('**/__dump/*', r => r.fulfill({ contentType: 'application/json', body: readFileSync(join(dump, r.request().url().split('/').pop())) }));
  await p.route(/unpkg\.com|fonts\.googleapis/, r => r.abort());
  const shot = async name => { if (shots) await p.screenshot({ path: join(shots, `${name}.png`) }); };
  return { p, errors, shot };
}
const visit = async (p, hash) => { await p.evaluate(h => { location.hash = h; }, hash); await p.waitForTimeout(400); };

// ----- demo mode -----
{
  const { p, errors } = await page();
  await p.goto(base + '?demo=1');
  await p.click('[data-user="u_anna"]');
  await p.waitForSelector('.nav');
  for (const h of ['#/kundinnen', '#/nachrichten/chats', '#/nachrichten/geplant', '#/nachrichten/gesendet', '#/einnahmen', '#/einstellungen']) await visit(p, h);
  await visit(p, '#/kundinnen');
  await p.click('.card[data-href^="#/kundin/"]');
  await p.waitForSelector('.overlay.open .stat-grid');
  check(errors.length === 0, `demo: all screens without errors ${errors.join(' | ')}`);
}

// ----- Supabase mode (fake client, real Florence rows) -----
{
  const { p, errors, shot } = await page();
  await p.goto(base);
  await p.waitForSelector('form[data-login-email]');
  await p.fill('#email', 'stranger@test'); await p.click('form[data-login-email] button');
  await p.waitForTimeout(300);
  check((await p.textContent('[data-error]')).includes('keinen Zugang'), 'unknown e-mail gets no code');
  await p.fill('#email', 'mai@test'); await p.click('form[data-login-email] button');
  await p.waitForSelector('form[data-login-code]');
  const otp = await p.evaluate(() => window.__otp);
  check(otp.options.shouldCreateUser === false, 'sign-in never creates new accounts');
  await p.fill('#code', '000000'); await p.click('form[data-login-code] button[type=submit]');
  await p.waitForTimeout(300);
  check((await p.textContent('[data-error]')).includes('falsch oder abgelaufen'), 'wrong code shows an error');
  await shot('real-login-code');
  await p.fill('#code', '123 456'); await p.click('form[data-login-code] button[type=submit]');
  await p.waitForSelector('.nav');
  check((await p.textContent('.header-salon')).includes('Florence'), 'signed in, salon Florence loaded');
  check((await p.textContent('.demo-banner')).includes('gili-test'), 'banner says this is the test database');
  await shot('real-termine');

  await visit(p, '#/kundinnen');
  const count = await p.$$eval('.card[data-href^="#/kundin/"]', els => els.length);
  check(count === 40, `client list shows ${count} entries`);
  await shot('real-kundinnen');

  await visit(p, '#/nachrichten/chats');
  check(await p.$$eval('.card', els => els.length) === 15, 'chat list: one entry per WhatsApp number');
  check(await p.$('.card-more') !== null, 'shared number marked with +N');
  await p.click('.card:has(.card-more)');
  await p.waitForSelector('.overlay.open .chat-messages');
  check(await p.$$eval('.msg', els => els.length) > 100, 'chat of the shared number shows its history');
  await shot('real-chat');

  // A person on the shared number: toggle reviews, record consent.
  await visit(p, '#/kundinnen');
  await p.fill('[data-search]', 'Mili');
  await p.click('.card[data-href^="#/kundin/"]');
  await p.waitForSelector('.overlay.open .stat-grid');
  check((await p.textContent('.overlay')).includes('Gleiche WhatsApp-Nummer'), 'profile links the other people on the number');
  await shot('real-kundin');
  await p.click('label.switch:has(input[data-field="reviews_enabled"])');
  await p.waitForTimeout(400);
  p.once('dialog', d => d.accept());
  await p.click('label.switch:has(input[data-field="marketing_consent"])');
  await p.waitForTimeout(400);
  const writes = await p.evaluate(() => window.__writes);
  check(writes.some(w => w.table === 'people' && w.op === 'update' && w.payload.reviews_enabled === false && w.rows === 1), 'reviews toggle writes to people');
  check(writes.some(w => w.table === 'contacts' && w.op === 'update' && w.payload.marketing_consent === true && w.payload.consent_at && w.rows === 1), 'consent writes to contacts with a timestamp');

  await visit(p, '#/einstellungen');
  await p.click('.radio:has(input[value="auto"])');
  await p.waitForTimeout(400);
  const w2 = await p.evaluate(() => window.__writes.at(-1));
  check(w2.table === 'automation_settings' && w2.op === 'update' && w2.payload.approval_mode === 'auto' && !('salon_id' in w2.payload),
    'settings saved by update, without touching salon_id');
  await shot('real-einstellungen');

  for (const h of ['#/termine', '#/nachrichten/geplant', '#/nachrichten/gesendet', '#/einnahmen']) await visit(p, h);
  check(errors.length === 0, `supabase mode: no page errors ${errors.join(' | ')}`);
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
