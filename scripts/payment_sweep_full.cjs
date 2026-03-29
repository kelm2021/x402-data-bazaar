const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const BASE = 'https://x402.aurelianflo.com';
const SELF_TAG_HEADER_NAME = 'x-metrics-source';
const SELF_TAG_HEADER_VALUE = 'self';

function nowIso() { return new Date().toISOString(); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function decodeBase64Json(value) {
  if (!value) return null;
  try { return JSON.parse(Buffer.from(String(value), 'base64').toString('utf8')); }
  catch { return null; }
}

function getAwalDistDir() {
  const candidate = path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'awal', 'dist');
  if (candidate && fs.existsSync(path.join(candidate, 'ipcClient.js'))) return candidate;
  throw new Error('Unable to locate awal dist ipcClient.js');
}

async function loadAwalIpc() {
  const distDir = getAwalDistDir();
  const ipcModuleUrl = pathToFileURL(path.join(distDir, 'ipcClient.js')).href;
  const authModuleUrl = pathToFileURL(path.join(distDir, 'utils', 'authCheck.js')).href;
  const { sendIpcRequest } = await import(ipcModuleUrl);
  const { requireAuth } = await import(authModuleUrl);
  return { requireAuth, sendIpcRequest };
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!response.ok) {
    throw new Error(`Fetch ${url} failed ${response.status}: ${text.slice(0, 300)}`);
  }
  return data;
}

const urlOverridesByRouteKey = {
  'GET /api/stocks/search': `${BASE}/api/stocks/search?q=apple&limit=5`,
  'GET /api/nutrition/search': `${BASE}/api/nutrition/search?query=chicken&limit=5`,
  'GET /api/geocode': `${BASE}/api/geocode?q=1600+Pennsylvania+Ave+NW,+Washington,+DC&limit=1`,
  'GET /api/reverse-geocode': `${BASE}/api/reverse-geocode?lat=40.7128&lon=-74.0060`,
  'GET /api/weather/air-quality': `${BASE}/api/weather/air-quality?zip=20002`,
  'GET /api/weather/historical': `${BASE}/api/weather/historical?lat=40.7128&lon=-74.0060&start=2025-03-01&end=2025-03-03`,
  'GET /api/weather/marine': `${BASE}/api/weather/marine?lat=40.7128&lon=-74.0060&hours=24`,
  'GET /api/weather/extremes': `${BASE}/api/weather/extremes?lat=40.7128&lon=-74.0060&days=7`,
  'GET /api/weather/freeze-risk': `${BASE}/api/weather/freeze-risk?lat=40.7128&lon=-74.0060&days=7&threshold_f=32`,
  'GET /api/courts/cases': `${BASE}/api/courts/cases?query=apple&limit=5`,
  'GET /api/courts/opinions': `${BASE}/api/courts/opinions?query=antitrust&limit=5`,
  'GET /api/courts/court-info': `${BASE}/api/courts/court-info?id=scotus&limit=1`,
  'GET /api/courts/clusters': `${BASE}/api/courts/clusters?query=apple&limit=5`,
  'GET /api/vendor-onboarding/restricted-party-batch': `${BASE}/api/vendor-onboarding/restricted-party-batch?names=Acme+Corp|Globex+LLC`,
  'GET /api/vendor-entity-brief': `${BASE}/api/vendor-entity-brief?name=Acme+Corp&country=US`,
  'GET /api/sports/schedule/*': `${BASE}/api/sports/schedule/Patriots?sport=nfl&limit=5`,
  'GET /api/sports/odds/*': `${BASE}/api/sports/odds/nba?regions=us&markets=h2h`,
};

const postBodyByPath = {
  '/api/sim/probability': {
    parameters: { labor: 0.2, monetary: -0.1, yield: 0.15 },
    threshold: 0,
  },
  '/api/sim/compare': {
    baseline: { parameters: { labor: 0.1, monetary: -0.05, yield: 0.05 }, threshold: 0 },
    candidate: { parameters: { labor: 0.3, monetary: -0.15, yield: 0.2 }, threshold: 0 },
    labels: { baseline: 'baseline', candidate: 'candidate' },
  },
  '/api/sim/sensitivity': {
    scenario: { parameters: { labor: 0.2, monetary: -0.1, yield: 0.1 }, threshold: 0 },
    parameter: 'labor',
    delta: 0.05,
    mode: 'absolute',
  },
  '/api/sim/forecast': {
    scenario: { parameters: { labor: 0.2, monetary: -0.1, yield: 0.1 }, threshold: 0 },
    periods: 6,
    uncertainty_growth: 0.05,
    growth_mode: 'additive',
  },
  '/api/sim/composed': {
    components: [
      { label: 'growth', weight: 0.6, scenario: { parameters: { labor: 0.25, yield: 0.2 }, threshold: 0 } },
      { label: 'headwinds', weight: 0.4, scenario: { parameters: { monetary: -0.2 }, threshold: 0 } },
    ],
  },
  '/api/sim/optimize': {
    scenario: { parameters: { labor: 0.2, monetary: -0.1, yield: 0.1 }, threshold: 0 },
    bounds: {
      labor: { min: -1, max: 1 },
      monetary: { min: -1, max: 1 },
      yield: { min: -1, max: 1 },
    },
    iterations: 50,
    objective: 'outcome_probability',
  },
};

function summarize(results) {
  const out = {
    total: results.length,
    ok2xx: 0,
    non2xx: 0,
    transportFailed: 0,
    paidAuthThenRejectedByServer: 0,
    facilitatorVerify401: 0,
  };

  for (const r of results) {
    if (r.transportError) {
      out.transportFailed += 1;
      if (/Facilitator verify failed \(401\)/i.test(r.transportError)) {
        out.facilitatorVerify401 += 1;
      }
      continue;
    }
    if (r.status >= 200 && r.status < 300) {
      out.ok2xx += 1;
    } else {
      out.non2xx += 1;
      if (r.paymentAuthorized) out.paidAuthThenRejectedByServer += 1;
    }
  }
  return out;
}

(async () => {
  const { requireAuth, sendIpcRequest } = await loadAwalIpc();
  await requireAuth();

  const discovery = await fetchJson(`${BASE}/api`);
  const catalog = Array.isArray(discovery?.catalog) ? discovery.catalog : [];

  const startedAt = nowIso();
  const results = [];

  for (let i = 0; i < catalog.length; i += 1) {
    const entry = catalog[i];
    const routeKey = entry.routeKey;
    const method = String(entry.method || 'GET').toUpperCase();
    const targetUrl = urlOverridesByRouteKey[routeKey] || entry.exampleUrl;

    const row = {
      index: i + 1,
      routeKey,
      method,
      path: entry.path,
      category: entry.category,
      priceUsd: entry.priceUsd,
      targetUrl,
      status: null,
      ok: false,
      paymentAuthorized: false,
      paymentResponse: null,
      provider: null,
      transportError: null,
      serverError: null,
    };

    try {
      const parsed = new URL(targetUrl);
      const payload = {
        baseURL: `${parsed.protocol}//${parsed.host}`,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: {
          [SELF_TAG_HEADER_NAME]: SELF_TAG_HEADER_VALUE,
        },
        maxAmountPerRequest: 300000,
      };

      if (method === 'POST') {
        const postBody = postBodyByPath[parsed.pathname];
        if (postBody) {
          payload.body = postBody;
          payload.headers['content-type'] = 'application/json';
        }
      }

      const result = await sendIpcRequest('make-x402-request', payload);
      row.status = Number(result?.status || 0);
      row.ok = row.status >= 200 && row.status < 300;

      const paymentResponseHeader = result?.headers?.['PAYMENT-RESPONSE'] || result?.headers?.['payment-response'];
      const paymentResponse = decodeBase64Json(paymentResponseHeader);
      row.paymentResponse = paymentResponse;
      row.paymentAuthorized = Boolean(paymentResponse?.success);
      row.provider = result?.headers?.['x-facilitator-provider'] || result?.headers?.['X-Facilitator-Provider'] || null;

      if (!row.ok) {
        const body = result?.data;
        if (typeof body === 'string') {
          row.serverError = body.slice(0, 400);
        } else if (body && typeof body === 'object') {
          row.serverError = JSON.stringify(body).slice(0, 400);
        } else {
          row.serverError = result?.statusText || 'Non-2xx response';
        }
      }
    } catch (error) {
      row.transportError = error instanceof Error ? error.message : String(error);
    }

    results.push(row);
    await sleep(120);
  }

  const finishedAt = nowIso();
  const summary = summarize(results);
  const failures = results.filter((r) => !r.ok);

  const payload = {
    generatedAt: finishedAt,
    startedAt,
    baseUrl: BASE,
    catalogCount: catalog.length,
    summary,
    failures,
    results,
  };

  const stamp = finishedAt.replace(/[:.]/g, '-');
  const outDir = path.join(process.cwd(), 'ops-dashboard');
  fs.mkdirSync(outDir, { recursive: true });
  const fullPath = path.join(outDir, `payment-sweep-prod-full-${stamp}.json`);
  const latestPath = path.join(outDir, 'payment-sweep-prod-full-latest.json');
  fs.writeFileSync(fullPath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(payload, null, 2));

  console.log(JSON.stringify({
    ok: true,
    fullPath,
    latestPath,
    catalogCount: catalog.length,
    summary,
    failureCount: failures.length,
  }, null, 2));
})();
