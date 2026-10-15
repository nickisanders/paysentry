// PaySentry dashboard server. Zero dependencies.
// GET  /            dashboard (AG Grid UI)
// GET  /api/state   processed results + policy + ledger summary
// POST /api/seed    reseed the sandbox demo batch (spawns seed script)
// POST /api/process run the analyst over unprocessed invoices
// POST /api/policy  update policy limits
import http from 'http';
import { execFile } from 'child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { ROOT } from './env.js';
import { listInvoices, getInvoice } from './paypal.js';
import { processInvoice, loadResults } from './engine.js';
import { loadLedger } from './ledger.js';

const PORT = process.env.PORT || 8080;
const POLICY = join(ROOT, 'policy.json');

const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => t > now - 60_000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 20;
}

let busy = false;

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'content-type': type, 'access-control-allow-origin': '*' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

const readBody = (req) => new Promise((resolve) => {
  let d = '';
  req.on('data', (c) => { d += c; if (d.length > 10_000) req.destroy(); });
  req.on('end', () => resolve(d));
  req.on('error', () => resolve(''));
});

async function runProcess() {
  const items = await listInvoices();
  const todo = items.filter((i) => ['SENT', 'UNPAID'].includes(i.status)).reverse();
  const out = [];
  for (const item of todo) {
    const full = await getInvoice(item.id);
    const r = await processInvoice(full);
    if (!r.skipped) out.push(r.invoice.number);
  }
  return out;
}

function seedBatch() {
  return new Promise((resolve, reject) => {
    execFile('node', [join(ROOT, 'seed', 'seed.mjs')], { cwd: ROOT, timeout: 180_000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim().split('\n'));
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;

  try {
    if (url.pathname === '/health') return send(res, 200, { status: 'ok' });

    if (url.pathname === '/' && req.method === 'GET') return send(res, 200, HTML, 'text/html; charset=utf-8');

    if (url.pathname === '/api/state') {
      const results = loadResults();
      const ledger = loadLedger();
      const policy = JSON.parse(readFileSync(POLICY, 'utf8'));
      return send(res, 200, {
        processed: Object.values(results.processed || {}).sort((a, b) => (a.at < b.at ? 1 : -1)),
        spentToday: results.spentToday,
        policy,
        vendors: ledger.vendors.map((v) => ({ name: v.name, email: v.email, invoices: v.history.length })),
        busy,
      });
    }

    if (req.method === 'POST' && ['/api/seed', '/api/process', '/api/policy'].includes(url.pathname)) {
      if (limited(ip)) return send(res, 429, { error: 'rate limit' });

      if (url.pathname === '/api/policy') {
        const body = JSON.parse((await readBody(req)) || '{}');
        const cur = JSON.parse(readFileSync(POLICY, 'utf8'));
        for (const k of ['autoPayMax', 'dailyAutoPayTotal', 'reviewMax']) {
          if (body[k] !== undefined) {
            const n = Number(body[k]);
            if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return send(res, 400, { error: `bad ${k}` });
            cur[k] = n;
          }
        }
        if (body.newPayeeAlwaysHold !== undefined) cur.newPayeeAlwaysHold = !!body.newPayeeAlwaysHold;
        writeFileSync(POLICY, JSON.stringify(cur, null, 2));
        return send(res, 200, { ok: true, policy: cur });
      }

      if (busy) return send(res, 409, { error: 'another run is in progress' });
      busy = true;
      try {
        if (url.pathname === '/api/seed') {
          const log = await seedBatch();
          return send(res, 200, { ok: true, log });
        }
        const processed = await runProcess();
        return send(res, 200, { ok: true, processed });
      } finally {
        busy = false;
      }
    }

    return send(res, 404, { error: 'not found' });
  } catch (e) {
    busy = false;
    return send(res, 500, { error: e.message.slice(0, 300) });
  }
});

const HTML = readFileSync(join(ROOT, 'src', 'dashboard.html'), 'utf8');

server.listen(PORT, () => console.log(`paysentry dashboard on :${PORT}`));
