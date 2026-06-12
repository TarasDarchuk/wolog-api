#!/usr/bin/env node
/**
 * End-to-end smoke test for the AI connector against any deployment.
 *
 *   node scripts/connector-smoke.mjs https://staging.example.com [email]
 *
 * Requires OAUTH_DEV_LOGIN=true (and NODE_ENV != production) on the target —
 * the script signs in through the dev email provider on the consent flow.
 * Use an email you also signed into the iOS app with to watch the created
 * routine arrive on the phone after a sync.
 *
 * Exercises: dynamic client registration → authorize → consent → PKCE token
 * exchange → catalog search → routine create (fuzzy names + superset +
 * unknown name) → id-keyed PATCH (+2.5 kg) → 409 conflict → scope checks →
 * MCP initialize/tools → revocation.
 */

import { createHash, randomBytes } from 'node:crypto';

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const EMAIL = process.argv[3] || 'connector-smoke@test.dev';
const API = `${BASE}/api/v1`;

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗ FAIL'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function http(method, url, { json, form, token } = {}) {
  const headers = {};
  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form !== undefined) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(form).toString();
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

console.log(`\nConnector smoke test against ${BASE}\n`);

// ── 1. Discovery ────────────────────────────────────────────────────────────
console.log('Discovery');
{
  const health = await http('GET', `${API}/health`);
  check('GET /health', health.status === 200);
  const meta = await http('GET', `${BASE}/.well-known/oauth-authorization-server`);
  check(
    'authorization-server metadata',
    meta.status === 200 && meta.data.token_endpoint === `${BASE}/oauth/token`,
    meta.status !== 200 ? `status ${meta.status}` : '',
  );
  if (meta.data?.issuer && meta.data.issuer !== BASE) {
    check('PUBLIC_BASE_URL matches host', false, `issuer is ${meta.data.issuer}`);
  }
  const spec = await http('GET', `${BASE}/openapi.json`);
  check('openapi.json served', spec.status === 200 && !!spec.data.paths);
}

// ── 2. OAuth flow ───────────────────────────────────────────────────────────
console.log('OAuth');
const redirectUri = 'https://claude.ai/api/mcp/auth_callback';
const reg = await http('POST', `${BASE}/oauth/register`, {
  json: { client_name: 'Smoke Test', redirect_uris: [redirectUri] },
});
check('dynamic client registration', reg.status === 201 && !!reg.data.client_id);
const clientId = reg.data.client_id;

const verifier = randomBytes(48).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const authorizeParams = {
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: 'routines:read routines:write history:read',
  state: 'smoke',
  code_challenge: challenge,
  code_challenge_method: 'S256',
};

const page = await fetch(`${BASE}/oauth/authorize?` + new URLSearchParams(authorizeParams));
check('consent page renders', page.status === 200 && (await page.text()).includes('wants permission'));

const consent = await http('POST', `${BASE}/oauth/consent`, {
  json: { decision: 'allow', provider: 'dev', credential: EMAIL, authorize: authorizeParams },
});
check(
  'consent (dev login) issues code',
  consent.status === 200 && /code=wlgc_/.test(consent.data?.redirect ?? ''),
  consent.status !== 200
    ? `status ${consent.status} — is OAUTH_DEV_LOGIN=true set on the target?`
    : '',
);
if (consent.status !== 200) {
  console.log('\nCannot continue without dev login. Aborting.');
  process.exit(1);
}
const code = new URL(consent.data.redirect).searchParams.get('code');

const tokenRes = await http('POST', `${BASE}/oauth/token`, {
  form: {
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  },
});
check('PKCE token exchange', tokenRes.status === 200 && tokenRes.data.access_token?.startsWith('wlga_'));

const refreshed = await http('POST', `${BASE}/oauth/token`, {
  form: { grant_type: 'refresh_token', refresh_token: tokenRes.data.refresh_token, client_id: clientId },
});
check('refresh token rotation', refreshed.status === 200 && refreshed.data.access_token !== tokenRes.data.access_token);
// Rotation revokes the old pair — continue with the fresh token.
const access = refreshed.data.access_token;

// ── 3. Catalog + routine round-trip ────────────────────────────────────────
console.log('Routines');
const catalog = await http('GET', `${API}/exercises?` + new URLSearchParams({ query: 'bench press' }), { token: access });
check('catalog search', catalog.status === 200 && catalog.data.exercises.length > 0,
  catalog.data?.exercises?.length === 0 ? 'no results — did the seed run on this DB?' : '');

const created = await http('POST', `${API}/routines`, {
  token: access,
  json: {
    name: `Smoke Test ${new Date().toISOString().slice(0, 16)}`,
    items: [
      { exercise: { name: 'Bench Press', targetSets: 3, targetReps: 5, sets: [{ targetWeight: 60, targetReps: 5 }, { targetWeight: 62.5, targetReps: 5 }] } },
      { exercise: { name: 'ohp', targetSets: 3, targetReps: 8 } },
      { exercise: { name: 'rdl', targetSets: 3, targetReps: 10 } },
      { superset: { supersetColorIndex: 0, exercises: [{ name: 'Lat Pulldown', targetSets: 3, targetReps: 12 }, { name: 'Face Pull', targetSets: 3, targetReps: 15 }] } },
      { exercise: { name: 'Smoke Nonsense Movement', targetSets: 2, targetReps: 10 } },
    ],
  },
});
check('create routine', created.status === 201 || created.status === 200,
  created.status === 403 ? 'PRO_REQUIRED — user already has 5 routines; use a fresh email' : JSON.stringify(created.data).slice(0, 120));
const routineId = created.data?.routine?.id;
if (!routineId) {
  console.log('\nCannot continue without a created routine. Aborting.');
  process.exit(1);
}
if (created.data?.resolutions) {
  for (const r of created.data.resolutions) {
    console.log(`      ${r.requested} → ${r.resolvedTo} (${r.method}, ${r.confidence}${r.createdCustom ? ', created custom' : ''})`);
  }
  const fuzzyOk = created.data.resolutions.filter((r) => !r.createdCustom).every((r) => r.confidence >= 0.6);
  check('all known names resolved confidently', fuzzyOk);
  check('unknown name created as custom', created.data.resolutions.some((r) => r.createdCustom));
}

const full = await http('GET', `${API}/routines/${routineId}`, { token: access });
check('read routine', full.status === 200);

// Progressive overload: echo back the read structure, bump weights.
const patchBody = structuredClone(full.data);
const beforeIds = {
  te: patchBody.items[0].exercise.id,
  sets: patchBody.items[0].exercise.sets.map((s) => s.id),
};
for (const s of patchBody.items[0].exercise.sets) {
  if (s.targetWeight != null) s.targetWeight += 2.5;
}
patchBody.baseUpdatedAt = full.data.updatedAt;
const patched = await http('PATCH', `${API}/routines/${routineId}`, { token: access, json: patchBody });
const afterEx = patched.data?.routine?.items?.[0]?.exercise;
check('PATCH applies new weights', patched.status === 200 && afterEx?.sets?.[0]?.targetWeight === 62.5);
check('exercise/set ids preserved (merge, not replace)',
  afterEx?.id === beforeIds.te && afterEx?.sets?.map((s) => s.id).join() === beforeIds.sets.join());

const stale = await http('PATCH', `${API}/routines/${routineId}`, {
  token: access,
  json: { items: patchBody.items, baseUpdatedAt: full.data.updatedAt },
});
check('stale baseUpdatedAt → 409 with current routine', stale.status === 409 && stale.data?.current?.id === routineId);

// ── 4. History + MCP ────────────────────────────────────────────────────────
console.log('History & MCP');
const workouts = await http('GET', `${API}/workouts?limit=5`, { token: access });
check('GET /workouts', workouts.status === 200);

const unauth = await http('POST', `${BASE}/mcp`, { json: { jsonrpc: '2.0', id: 1, method: 'initialize' } });
check('MCP 401 challenge', unauth.status === 401 && (unauth.headers.get('www-authenticate') ?? '').includes('resource_metadata'));

const init = await http('POST', `${BASE}/mcp`, {
  token: access,
  json: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } },
});
check('MCP initialize', init.status === 200 && init.data.result?.serverInfo?.name === 'wolog-connector');

const tools = await http('POST', `${BASE}/mcp`, { token: access, json: { jsonrpc: '2.0', id: 2, method: 'tools/list' } });
check('MCP tools/list', tools.status === 200 && tools.data.result?.tools?.length === 6);

const toolCall = await http('POST', `${BASE}/mcp`, {
  token: access,
  json: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_routine', arguments: { id: routineId } } },
});
check('MCP tools/call get_routine', toolCall.status === 200 && !toolCall.data.result?.isError);

// ── 5. Revocation ───────────────────────────────────────────────────────────
console.log('Revocation');
await http('POST', `${BASE}/oauth/revoke`, { form: { token: access } });
const afterRevoke = await http('GET', `${API}/routines`, { token: access });
check('revoked token is rejected', afterRevoke.status === 401);

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} CHECK(S) FAILED.`}`);
console.log(`Test data left on server for user ${EMAIL}: routine ${routineId} + 1 custom exercise.`);
console.log('Sign into the iOS app with the same account to watch it arrive via sync.\n');
process.exit(failures === 0 ? 0 : 1);
