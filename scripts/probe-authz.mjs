/**
 * Adversarial probe of the authorization surface, over real HTTP.
 *
 * Why this exists: the unit suite proves `can()` returns the right boolean for
 * every role and action. It does not prove a single route handler ever asks.
 * That gap is the honest limit of the unit tests, and this closes it — it
 * forges a valid session for each seeded user and drives the deployed
 * endpoints, asserting the status code the rules imply.
 *
 * It reads SESSION_SECRET so it can mint cookies the server will accept. That
 * is deliberate: the point is to test *authorization*, so it starts from a
 * position of authenticated identity and tries to exceed it.
 *
 *   npm run probe                      # against http://localhost:3000
 *   npm run probe -- https://<url>     # against the deployment
 *
 * Assumes `npm run db:seed` has been run and its state is untouched.
 */
import { createHmac } from 'node:crypto';
import { config } from 'dotenv';

config({ path: '.env.local' });

const BASE = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const SECRET = process.env.SESSION_SECRET?.trim();

if (!SECRET) {
  console.error('SESSION_SECRET is not set. Add it to .env.local or export it.');
  process.exit(2);
}

// Fixed ids from src/db/seed.ts.
const ADA = '11111111-1111-4111-8111-111111111111';
const GRACE = '22222222-2222-4222-8222-222222222222';
const ALAN = '33333333-3333-4333-8333-333333333333';
const DOC = 'aaaaaaaa-0000-4000-8000-000000000001';

function cookieFor(userId) {
  const payload = `${userId}.${Math.floor(Date.now() / 1000) + 3600}`;
  return `ajaia_session=${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
}

const request = (path, { as, method = 'GET', body } = {}) =>
  fetch(`${BASE}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(as ? { cookie: cookieFor(as) } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

let passed = 0;
let failed = 0;

async function expect(label, wanted, send) {
  const response = await send();
  const list = Array.isArray(wanted) ? wanted : [wanted];
  if (list.includes(response.status)) {
    passed++;
    console.log(`  ok    ${label} -> ${response.status}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label} -> ${response.status} (expected ${list.join(' or ')})`);
  }
}

const paragraph = (text) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

console.log(`\nProbing ${BASE}\n`);

console.log('Signed out');
await expect('the dashboard redirects to the identity picker', [302, 307], () => request('/'));
await expect('writing without a session is refused', 401, () =>
  request(`/api/documents/${DOC}`, { method: 'PATCH', body: { title: 'x' } }),
);

console.log('\nOwner');
await expect('opens the document', 200, () => request(`/docs/${DOC}`, { as: ADA }));
await expect('renames it', 200, () =>
  request(`/api/documents/${DOC}`, { as: ADA, method: 'PATCH', body: { title: 'Q3 Product Planning' } }),
);
await expect('a malformed id is a 404, not a 500 from a failed uuid cast', 404, () =>
  request('/docs/not-a-uuid', { as: ADA }),
);
await expect('a well-formed id that does not exist is a 404', 404, () =>
  request('/docs/00000000-0000-4000-8000-000000000000', { as: ADA }),
);
await expect('sharing with an unknown address fails cleanly', 404, () =>
  request(`/api/documents/${DOC}/shares`, { as: ADA, method: 'POST', body: { email: 'nobody@nowhere.test' } }),
);
await expect('cannot share with themselves', 400, () =>
  request(`/api/documents/${DOC}/shares`, { as: ADA, method: 'POST', body: { email: 'ada@ajaia.demo' } }),
);
await expect('shares with a collaborator', 201, () =>
  request(`/api/documents/${DOC}/shares`, { as: ADA, method: 'POST', body: { email: 'grace@ajaia.demo' } }),
);
await expect('re-sharing is idempotent, and the address is normalized', 201, () =>
  request(`/api/documents/${DOC}/shares`, { as: ADA, method: 'POST', body: { email: '  GRACE@Ajaia.Demo  ' } }),
);
await expect('content outside the node allowlist is rejected', 400, () =>
  request(`/api/documents/${DOC}`, {
    as: ADA,
    method: 'PATCH',
    body: { content: { type: 'doc', content: [{ type: 'image', attrs: { src: 'x' } }] } },
  }),
);

console.log('\nCollaborator');
await expect('sees the document', 200, () => request(`/docs/${DOC}`, { as: GRACE }));
await expect('edits the body', 200, () =>
  request(`/api/documents/${DOC}`, { as: GRACE, method: 'PATCH', body: { content: paragraph('edited by a collaborator') } }),
);
await expect('cannot rename it', 403, () =>
  request(`/api/documents/${DOC}`, { as: GRACE, method: 'PATCH', body: { title: 'mine now' } }),
);
await expect('cannot delete it', 403, () => request(`/api/documents/${DOC}`, { as: GRACE, method: 'DELETE' }));
await expect('cannot pass access along', 403, () =>
  request(`/api/documents/${DOC}/shares`, { as: GRACE, method: 'POST', body: { email: 'alan@ajaia.demo' } }),
);
await expect('cannot seize ownership via mass assignment', 400, () =>
  request(`/api/documents/${DOC}`, { as: GRACE, method: 'PATCH', body: { ownerId: GRACE } }),
);

console.log('\nStranger');
await expect('gets a 404, not a 403 — no existence oracle', 404, () => request(`/docs/${DOC}`, { as: ALAN }));
await expect('writing is a 404 too', 404, () =>
  request(`/api/documents/${DOC}`, { as: ALAN, method: 'PATCH', body: { content: paragraph('nope') } }),
);
await expect('cannot share what they cannot see', 404, () =>
  request(`/api/documents/${DOC}/shares`, { as: ALAN, method: 'POST', body: { email: 'alan@ajaia.demo' } }),
);

console.log('\nRevocation');
await expect('the owner revokes access', 204, () =>
  request(`/api/documents/${DOC}/shares`, { as: ADA, method: 'DELETE', body: { userId: GRACE } }),
);
await expect('the former collaborator is now a stranger', 404, () => request(`/docs/${DOC}`, { as: GRACE }));

console.log(`\n${passed} passed, ${failed} failed`);
console.log('Run `npm run db:seed` to restore the demo state this mutated.\n');

process.exit(failed === 0 ? 0 : 1);
