'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Tests exercise the standalone CommonJS runner. */

const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const test = require('node:test');

const {
  evaluateThresholds,
  percentile,
  runProfile,
  validateFixture,
  validateTarget,
} = require('./organizations.js');

function organization(index) {
  const suffix = String(index).padStart(2, '0');
  return {
    id: `load-org-${suffix}`,
    sessionCookie: `next-auth.session-token=local-session-${suffix}`,
    isolationMarker: {
      path: '/api/settings',
      jsonPath: 'workspace.name',
      equals: `Load Restaurant ${suffix}`,
    },
    authenticatedReads: [
      { name: 'overview', path: '/api/overview' },
      { name: 'requests', path: '/api/requests?limit=5' },
    ],
    supplierQuote: {
      token: `${suffix}${'a'.repeat(41)}`,
      isolationMarker: {
        jsonPath: 'restaurantName',
        equals: `Load Restaurant ${suffix}`,
      },
      submission: {
        expectedLatestRevision: 0,
        deliveryDate: '2099-09-02',
        validUntil: '2099-09-15',
        freightInr: '0',
        commercialTerms: 'Payment in 15 days.',
        notes: 'Bounded launch verification.',
        items: [
          {
            requestItemId: `load-item-${suffix}`,
            noQuote: false,
            availableQuantity: '10',
            unitRateInr: '50',
            gstPercent: '5',
            taxInclusive: false,
            substitution: '',
          },
        ],
      },
    },
  };
}

function fixture() {
  return {
    schemaVersion: 1,
    readinessPath: '/api/health/ready',
    organizations: Array.from({ length: 20 }, (_, index) => organization(index + 1)),
  };
}

test('calculates nearest-rank p95 without mutating samples', () => {
  const samples = Array.from({ length: 100 }, (_, index) => 100 - index);
  assert.equal(percentile(samples, 95), 95);
  assert.equal(samples[0], 100);
});

test('requires every launch threshold and treats 800 ms as a failure', () => {
  const passing = evaluateThresholds({
    organizationCount: 20,
    errorCount: 0,
    isolationMismatchCount: 0,
    authenticatedDurationsMs: [120, 340, 799],
    authenticatedReadCount: 60,
    quoteSubmissionCount: 20,
    poolSaturationSignalCount: 0,
  });
  assert.equal(passing.pass, true);
  assert.equal(passing.authenticatedP95Ms, 799);

  const atLimit = evaluateThresholds({
    organizationCount: 20,
    errorCount: 0,
    isolationMismatchCount: 0,
    authenticatedDurationsMs: [800],
    authenticatedReadCount: 60,
    quoteSubmissionCount: 20,
    poolSaturationSignalCount: 0,
  });
  assert.equal(atLimit.pass, false);
  assert.match(atLimit.reasons.join(' '), /below 800 ms/i);

  const incomplete = evaluateThresholds({
    organizationCount: 20,
    errorCount: 1,
    isolationMismatchCount: 1,
    authenticatedDurationsMs: [200],
    authenticatedReadCount: 59,
    quoteSubmissionCount: 19,
    poolSaturationSignalCount: 1,
  });
  assert.equal(incomplete.pass, false);
  assert.ok(incomplete.reasons.length >= 5);
});

test('permits loopback by default and makes every remote target an explicit choice', () => {
  assert.equal(
    validateTarget('http://127.0.0.1:3000', {}).targetEnvironment,
    'local',
  );
  assert.throws(
    () => validateTarget('https://preview.example.test', {}),
    /LOAD_TARGET_ENV/,
  );
  assert.throws(
    () => validateTarget('https://preview.example.test', {
      LOAD_TARGET_ENV: 'staging',
    }),
    /LOAD_ALLOW_REMOTE=1/,
  );
  assert.equal(
    validateTarget('https://preview.example.test', {
      LOAD_TARGET_ENV: 'staging',
      LOAD_ALLOW_REMOTE: '1',
    }).targetEnvironment,
    'staging',
  );
  assert.throws(
    () => validateTarget('https://quoteplate.example', {
      LOAD_TARGET_ENV: 'production',
      LOAD_ALLOW_REMOTE: '1',
    }),
    /LOAD_ALLOW_PRODUCTION=I_ACCEPT_BOUNDED_PRODUCTION_LOAD/,
  );
  assert.equal(
    validateTarget('https://quoteplate.example', {
      LOAD_TARGET_ENV: 'production',
      LOAD_ALLOW_PRODUCTION: 'I_ACCEPT_BOUNDED_PRODUCTION_LOAD',
    }).targetEnvironment,
    'production',
  );
  assert.throws(
    () => validateTarget('http://remote.example.test', {
      LOAD_TARGET_ENV: 'staging',
      LOAD_ALLOW_REMOTE: '1',
    }),
    /HTTPS/,
  );
});

test('accepts exactly 20 isolated, single-use organization fixtures', () => {
  const result = validateFixture(fixture());
  assert.equal(result.organizations.length, 20);
  assert.equal(result.readinessPath, '/api/health/ready');
  assert.equal(
    result.organizations[0].supplierQuote.isolationMarker.equals,
    'Load Restaurant 01',
  );
});

test('rejects unbounded, ambiguous, or non-isolated fixture input', () => {
  const nineteen = fixture();
  nineteen.organizations.pop();
  assert.throws(() => validateFixture(nineteen), /exactly 20/);

  const tooManyReads = fixture();
  tooManyReads.organizations[0].authenticatedReads.push(
    { name: 'history', path: '/api/history' },
    { name: 'insights', path: '/api/insights' },
  );
  assert.throws(() => validateFixture(tooManyReads), /at most 3/);

  const absolutePath = fixture();
  absolutePath.organizations[0].authenticatedReads[0].path =
    'https://attacker.example/collect';
  assert.throws(() => validateFixture(absolutePath), /same-origin relative path/);

  const duplicateToken = fixture();
  duplicateToken.organizations[1].supplierQuote.token =
    duplicateToken.organizations[0].supplierQuote.token;
  assert.throws(() => validateFixture(duplicateToken), /unique supplier quote token/);

  const missingMarker = fixture();
  delete missingMarker.organizations[0].isolationMarker;
  assert.throws(() => validateFixture(missingMarker), /isolationMarker/);

  const missingPublicMarker = fixture();
  delete missingPublicMarker.organizations[0].supplierQuote.isolationMarker;
  assert.throws(() => validateFixture(missingPublicMarker), /supplierQuote.isolationMarker/);
});

test('runs bounded private reads, public isolation checks, and 20 concurrent submissions', async () => {
  const validated = validateFixture(fixture());
  const organizationByCookie = new Map(
    validated.organizations.map((entry) => [entry.sessionCookie, entry]),
  );
  const organizationByToken = new Map(
    validated.organizations.map((entry) => [entry.supplierQuote.token, entry]),
  );
  let publicIsolationReads = 0;
  let quoteSubmissions = 0;
  let corruptPrivateMarker = false;

  const server = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/health/ready') {
      response.end(JSON.stringify({ status: 'ready' }));
      return;
    }
    if (request.method === 'GET' && request.url === '/api/settings') {
      const organization = organizationByCookie.get(request.headers.cookie);
      if (!organization) {
        response.statusCode = 401;
        response.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      response.end(JSON.stringify({
        workspace: {
          name:
            corruptPrivateMarker && organization.id === 'load-org-01'
              ? 'Wrong Restaurant'
              : organization.isolationMarker.equals,
        },
      }));
      return;
    }
    if (
      request.method === 'GET' &&
      (request.url === '/api/overview' || request.url === '/api/requests?limit=5')
    ) {
      const organization = organizationByCookie.get(request.headers.cookie);
      response.statusCode = organization ? 200 : 401;
      response.end(JSON.stringify({ ok: Boolean(organization) }));
      return;
    }
    if (request.method === 'POST' && request.url === '/api/public/quote/access') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const token = JSON.parse(Buffer.concat(chunks).toString('utf8')).token;
      const organization = organizationByToken.get(token);
      if (!organization) {
        response.statusCode = 410;
        response.end(JSON.stringify({ error: 'unavailable' }));
        return;
      }
      response.statusCode = 201;
      response.setHeader(
        'set-cookie',
        `quoteplate_supplier_session=${token}; Path=/api/public/quote; HttpOnly`,
      );
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.url === '/api/public/quote') {
      const cookie = request.headers.cookie || '';
      const token = cookie.replace(/^quoteplate_supplier_session=/, '');
      const organization = organizationByToken.get(token);
      if (!organization) {
        response.statusCode = 410;
        response.end(JSON.stringify({ error: 'unavailable' }));
        return;
      }
      if (request.method === 'GET') {
        publicIsolationReads += 1;
        response.end(JSON.stringify({
          restaurantName: organization.supplierQuote.isolationMarker.equals,
        }));
        return;
      }
      if (request.method === 'POST') {
        quoteSubmissions += 1;
        response.statusCode = 201;
        response.end(JSON.stringify({ revision: 1 }));
        return;
      }
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const result = await runProfile({
      origin: `http://127.0.0.1:${address.port}`,
      targetEnvironment: 'local',
      remote: false,
      fixture: validated,
      concurrency: 4,
      timeoutMs: 1_000,
    });
    assert.equal(result.evaluation.pass, true);
    assert.equal(publicIsolationReads, 20);
    assert.equal(quoteSubmissions, 20);
    assert.equal(result.metrics.isolationMismatchCount, 0);

    corruptPrivateMarker = true;
    publicIsolationReads = 0;
    quoteSubmissions = 0;
    const refused = await runProfile({
      origin: `http://127.0.0.1:${address.port}`,
      targetEnvironment: 'local',
      remote: false,
      fixture: validated,
      concurrency: 4,
      timeoutMs: 1_000,
    });
    assert.equal(refused.evaluation.pass, false);
    assert.equal(refused.metrics.isolationMismatchCount, 1);
    assert.equal(publicIsolationReads, 0);
    assert.equal(quoteSubmissions, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
