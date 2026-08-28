#!/usr/bin/env node
'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node runner; no package-mode change. */

const { readFile } = require('node:fs/promises');
const { performance } = require('node:perf_hooks');

const EXPECTED_ORGANIZATIONS = 20;
const P95_LIMIT_MS = 800;
const MAX_CONCURRENCY = 4;
const MAX_READS_PER_ORGANIZATION = 3;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_FIXTURE_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const PRODUCTION_CONFIRMATION = 'I_ACCEPT_BOUNDED_PRODUCTION_LOAD';
const SUPPLIER_COOKIE = 'quoteplate_supplier_session';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function percentile(values, percent) {
  if (!Array.isArray(values) || values.length === 0) return null;
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
    throw new Error('Percentile must be greater than 0 and at most 100.');
  }
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil((percent / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

function evaluateThresholds(metrics) {
  const authenticatedP95Ms = percentile(metrics.authenticatedDurationsMs, 95);
  const reasons = [];
  if (metrics.organizationCount !== EXPECTED_ORGANIZATIONS) {
    reasons.push(`Expected exactly ${EXPECTED_ORGANIZATIONS} organizations.`);
  }
  if (metrics.errorCount !== 0) {
    reasons.push(`Expected 0 request errors; observed ${metrics.errorCount}.`);
  }
  if (metrics.isolationMismatchCount !== 0) {
    reasons.push(
      `Expected 0 tenant-isolation mismatches; observed ${metrics.isolationMismatchCount}.`,
    );
  }
  if (metrics.authenticatedReadCount < metrics.organizationCount * 3) {
    reasons.push('Every organization must complete its marker and at least two private reads.');
  }
  if (authenticatedP95Ms === null || authenticatedP95Ms >= P95_LIMIT_MS) {
    reasons.push(`Authenticated p95 must be below ${P95_LIMIT_MS} ms.`);
  }
  if (metrics.quoteSubmissionCount !== EXPECTED_ORGANIZATIONS) {
    reasons.push(
      `Expected ${EXPECTED_ORGANIZATIONS} successful public quote submissions; observed ${metrics.quoteSubmissionCount}.`,
    );
  }
  if (metrics.poolSaturationSignalCount !== 0) {
    reasons.push(
      `Expected 0 readiness/timeout/503 pool-saturation signals; observed ${metrics.poolSaturationSignalCount}.`,
    );
  }
  return {
    pass: reasons.length === 0,
    reasons,
    authenticatedP95Ms,
  };
}

function isLoopback(hostname) {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

function validateTarget(baseUrl, environment = process.env) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('LOAD_BASE_URL must be a valid absolute URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('LOAD_BASE_URL must use HTTP or HTTPS.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('LOAD_BASE_URL must be an origin without credentials, query, or fragment.');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('LOAD_BASE_URL must not contain an application path.');
  }

  const loopback = isLoopback(url.hostname);
  if (loopback) {
    const targetEnvironment = environment.LOAD_TARGET_ENV || 'local';
    if (targetEnvironment !== 'local') {
      throw new Error('Loopback targets must use LOAD_TARGET_ENV=local.');
    }
    return { origin: url.origin, targetEnvironment, remote: false };
  }

  if (url.protocol !== 'https:') {
    throw new Error('Remote load targets must use HTTPS.');
  }
  const targetEnvironment = environment.LOAD_TARGET_ENV;
  if (!['staging', 'production'].includes(targetEnvironment)) {
    throw new Error('Remote targets require LOAD_TARGET_ENV=staging or production.');
  }
  if (targetEnvironment === 'production') {
    if (environment.LOAD_ALLOW_PRODUCTION !== PRODUCTION_CONFIRMATION) {
      throw new Error(
        `Production is blocked unless LOAD_ALLOW_PRODUCTION=${PRODUCTION_CONFIRMATION}.`,
      );
    }
  } else if (environment.LOAD_ALLOW_REMOTE !== '1') {
    throw new Error('Remote staging is blocked unless LOAD_ALLOW_REMOTE=1.');
  }
  return { origin: url.origin, targetEnvironment, remote: true };
}

function relativePath(value, label) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    throw new Error(`${label} must be a same-origin relative path.`);
  }
  const parsed = new URL(value, 'https://load.invalid');
  if (parsed.origin !== 'https://load.invalid' || parsed.hash) {
    throw new Error(`${label} must be a same-origin relative path without a fragment.`);
  }
  for (const key of parsed.searchParams.keys()) {
    if (/token|secret|password|authorization|api[-_]?key/i.test(key)) {
      throw new Error(`${label} must not put credentials in its query string.`);
    }
  }
  return `${parsed.pathname}${parsed.search}`;
}

function scalar(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function validateOrganization(value, index) {
  const label = `organizations[${index}]`;
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value.id)) {
    throw new Error(`${label}.id must be a short non-sensitive identifier.`);
  }
  if (
    typeof value.sessionCookie !== 'string' ||
    value.sessionCookie.length < 3 ||
    value.sessionCookie.length > 4096 ||
    !/^[^=;\r\n\s]+=[^;\r\n]+$/.test(value.sessionCookie)
  ) {
    throw new Error(`${label}.sessionCookie must contain exactly one session cookie pair.`);
  }
  if (!isRecord(value.isolationMarker)) {
    throw new Error(`${label}.isolationMarker is required.`);
  }
  const markerPath = relativePath(
    value.isolationMarker.path,
    `${label}.isolationMarker.path`,
  );
  if (
    typeof value.isolationMarker.jsonPath !== 'string' ||
    !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(value.isolationMarker.jsonPath)
  ) {
    throw new Error(`${label}.isolationMarker.jsonPath must be a simple dotted JSON path.`);
  }
  if (!scalar(value.isolationMarker.equals)) {
    throw new Error(`${label}.isolationMarker.equals must be a JSON scalar.`);
  }
  if (
    !Array.isArray(value.authenticatedReads) ||
    value.authenticatedReads.length < 2 ||
    value.authenticatedReads.length > MAX_READS_PER_ORGANIZATION
  ) {
    throw new Error(
      `${label}.authenticatedReads must contain 2 to at most ${MAX_READS_PER_ORGANIZATION} reads.`,
    );
  }
  const names = new Set();
  const authenticatedReads = value.authenticatedReads.map((read, readIndex) => {
    if (!isRecord(read)) throw new Error(`${label}.authenticatedReads[${readIndex}] is invalid.`);
    if (typeof read.name !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(read.name)) {
      throw new Error(`${label}.authenticatedReads[${readIndex}].name is invalid.`);
    }
    if (names.has(read.name)) throw new Error(`${label} contains a duplicate read name.`);
    names.add(read.name);
    return {
      name: read.name,
      path: relativePath(read.path, `${label}.authenticatedReads[${readIndex}].path`),
    };
  });
  if (!isRecord(value.supplierQuote)) {
    throw new Error(`${label}.supplierQuote is required.`);
  }
  if (
    typeof value.supplierQuote.token !== 'string' ||
    !/^[A-Za-z0-9_-]{43,512}$/.test(value.supplierQuote.token)
  ) {
    throw new Error(`${label}.supplierQuote.token must be a valid raw supplier token.`);
  }
  if (!isRecord(value.supplierQuote.isolationMarker)) {
    throw new Error(`${label}.supplierQuote.isolationMarker is required.`);
  }
  if (
    typeof value.supplierQuote.isolationMarker.jsonPath !== 'string' ||
    !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(
      value.supplierQuote.isolationMarker.jsonPath,
    )
  ) {
    throw new Error(
      `${label}.supplierQuote.isolationMarker.jsonPath must be a simple dotted JSON path.`,
    );
  }
  if (!scalar(value.supplierQuote.isolationMarker.equals)) {
    throw new Error(`${label}.supplierQuote.isolationMarker.equals must be a JSON scalar.`);
  }
  if (!isRecord(value.supplierQuote.submission)) {
    throw new Error(`${label}.supplierQuote.submission must be a JSON object.`);
  }
  const submissionBytes = Buffer.byteLength(
    JSON.stringify(value.supplierQuote.submission),
    'utf8',
  );
  if (submissionBytes > 256 * 1024) {
    throw new Error(`${label}.supplierQuote.submission is too large for this bounded profile.`);
  }
  return {
    id: value.id,
    sessionCookie: value.sessionCookie,
    isolationMarker: {
      path: markerPath,
      jsonPath: value.isolationMarker.jsonPath,
      equals: value.isolationMarker.equals,
    },
    authenticatedReads,
    supplierQuote: {
      token: value.supplierQuote.token,
      isolationMarker: {
        jsonPath: value.supplierQuote.isolationMarker.jsonPath,
        equals: value.supplierQuote.isolationMarker.equals,
      },
      submission: value.supplierQuote.submission,
    },
  };
}

function validateFixture(value) {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error('Fixture schemaVersion must be 1.');
  }
  if (
    !Array.isArray(value.organizations) ||
    value.organizations.length !== EXPECTED_ORGANIZATIONS
  ) {
    throw new Error(`Fixture must contain exactly ${EXPECTED_ORGANIZATIONS} organizations.`);
  }
  const organizations = value.organizations.map(validateOrganization);
  const ids = new Set();
  const cookies = new Set();
  const tokens = new Set();
  const markers = new Set();
  const publicMarkers = new Set();
  for (const organization of organizations) {
    if (ids.has(organization.id)) throw new Error('Every organization id must be unique.');
    if (cookies.has(organization.sessionCookie)) {
      throw new Error('Every organization session cookie must be unique.');
    }
    if (tokens.has(organization.supplierQuote.token)) {
      throw new Error('Every organization must use a unique supplier quote token.');
    }
    const marker = `${organization.isolationMarker.jsonPath}:${JSON.stringify(
      organization.isolationMarker.equals,
    )}`;
    if (markers.has(marker)) {
      throw new Error('Every organization must use a unique isolation marker.');
    }
    const publicMarker = `${organization.supplierQuote.isolationMarker.jsonPath}:${JSON.stringify(
      organization.supplierQuote.isolationMarker.equals,
    )}`;
    if (publicMarkers.has(publicMarker)) {
      throw new Error('Every organization must use a unique public quote isolation marker.');
    }
    ids.add(organization.id);
    cookies.add(organization.sessionCookie);
    tokens.add(organization.supplierQuote.token);
    markers.add(marker);
    publicMarkers.add(publicMarker);
  }
  return {
    schemaVersion: 1,
    readinessPath: relativePath(
      value.readinessPath || '/api/health/ready',
      'readinessPath',
    ),
    organizations,
  };
}

function readJsonPath(value, path) {
  let current = value;
  for (const segment of path.split('.')) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return { found: false, value: undefined };
    }
    current = current[segment];
  }
  return { found: true, value: current };
}

function sameScalar(left, right) {
  return Object.is(left, right);
}

function requestHeaders(origin, extra = {}) {
  return {
    accept: 'application/json',
    origin,
    'sec-fetch-site': 'same-origin',
    ...extra,
  };
}

async function boundedRequest({ origin, path, method = 'GET', headers, body, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers,
      body,
      redirect: 'error',
      signal: controller.signal,
    });
    const durationMs = performance.now() - startedAt;
    const statedBytes = Number(response.headers.get('content-length'));
    if (Number.isFinite(statedBytes) && statedBytes > MAX_RESPONSE_BYTES) {
      return {
        ok: false,
        status: response.status,
        durationMs,
        error: 'response exceeded the 1 MB safety limit',
        poolSignal: response.status === 503,
      };
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_RESPONSE_BYTES) {
      return {
        ok: false,
        status: response.status,
        durationMs,
        error: 'response exceeded the 1 MB safety limit',
        poolSignal: response.status === 503,
      };
    }
    let json = null;
    if (bytes.byteLength > 0) {
      try {
        json = JSON.parse(bytes.toString('utf8'));
      } catch {
        return {
          ok: false,
          status: response.status,
          durationMs,
          error: 'response was not valid JSON',
          poolSignal: response.status === 503,
        };
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      durationMs,
      json,
      setCookie: response.headers.get('set-cookie'),
      error: response.ok ? null : `HTTP ${response.status}`,
      poolSignal: response.status === 503,
    };
  } catch (error) {
    const timedOut = error && typeof error === 'object' && error.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      durationMs: performance.now() - startedAt,
      error: timedOut ? 'request timed out' : 'network request failed',
      poolSignal: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function mapConcurrent(items, concurrency, operation) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

function supplierCookie(setCookie) {
  if (typeof setCookie !== 'string') return null;
  const match = setCookie.match(
    new RegExp(`(?:^|,\\s*)${SUPPLIER_COOKIE}=([^;,\\s]+)`),
  );
  return match ? `${SUPPLIER_COOKIE}=${match[1]}` : null;
}

async function readinessCheck(config) {
  const result = await boundedRequest({
    origin: config.origin,
    path: config.fixture.readinessPath,
    headers: requestHeaders(config.origin),
    timeoutMs: config.timeoutMs,
  });
  return {
    ...result,
    ok: result.ok && result.status === 200 && result.json?.status === 'ready',
  };
}

async function runProfile(config) {
  const errors = [];
  let isolationMismatchCount = 0;
  let poolSaturationSignalCount = 0;
  let quoteSubmissionCount = 0;
  const authenticatedDurationsMs = [];

  const before = await readinessCheck(config);
  if (!before.ok) {
    throw new Error('Readiness failed before load; no organization traffic was sent.');
  }

  const authenticatedTasks = config.fixture.organizations.flatMap((organization) => [
    {
      organization,
      name: 'isolation-marker',
      path: organization.isolationMarker.path,
      marker: organization.isolationMarker,
    },
    ...organization.authenticatedReads.map((read) => ({
      organization,
      name: read.name,
      path: read.path,
      marker: null,
    })),
  ]);

  await mapConcurrent(authenticatedTasks, config.concurrency, async (task) => {
    const result = await boundedRequest({
      origin: config.origin,
      path: task.path,
      headers: requestHeaders(config.origin, { cookie: task.organization.sessionCookie }),
      timeoutMs: config.timeoutMs,
    });
    authenticatedDurationsMs.push(result.durationMs);
    if (result.poolSignal) poolSaturationSignalCount += 1;
    if (!result.ok || result.status !== 200) {
      errors.push({
        organizationId: task.organization.id,
        operation: `private:${task.name}`,
        reason: result.error || `HTTP ${result.status}`,
      });
      return;
    }
    if (task.marker) {
      const observed = readJsonPath(result.json, task.marker.jsonPath);
      if (!observed.found || !sameScalar(observed.value, task.marker.equals)) {
        isolationMismatchCount += 1;
        errors.push({
          organizationId: task.organization.id,
          operation: 'private:isolation-marker',
          reason: 'tenant marker mismatch',
          isolationOnly: true,
        });
      }
    }
  });

  if (errors.length === 0 && isolationMismatchCount === 0) {
    await mapConcurrent(config.fixture.organizations, config.concurrency, async (organization) => {
      const access = await boundedRequest({
      origin: config.origin,
      path: '/api/public/quote/access',
      method: 'POST',
      headers: requestHeaders(config.origin, { 'content-type': 'application/json' }),
      body: JSON.stringify({ token: organization.supplierQuote.token }),
      timeoutMs: config.timeoutMs,
    });
      if (access.poolSignal) poolSaturationSignalCount += 1;
      const cookie = supplierCookie(access.setCookie);
      if (!access.ok || access.status !== 201 || !cookie) {
        errors.push({
          organizationId: organization.id,
          operation: 'public:exchange-link',
          reason: access.error || 'supplier session cookie was not issued',
        });
        return;
      }
      const publicRead = await boundedRequest({
        origin: config.origin,
        path: '/api/public/quote',
        headers: requestHeaders(config.origin, { cookie }),
        timeoutMs: config.timeoutMs,
      });
      if (publicRead.poolSignal) poolSaturationSignalCount += 1;
      if (!publicRead.ok || publicRead.status !== 200) {
        errors.push({
          organizationId: organization.id,
          operation: 'public:check-isolation',
          reason: publicRead.error || `HTTP ${publicRead.status}`,
        });
        return;
      }
      const publicMarker = readJsonPath(
        publicRead.json,
        organization.supplierQuote.isolationMarker.jsonPath,
      );
      if (
        !publicMarker.found ||
        !sameScalar(
          publicMarker.value,
          organization.supplierQuote.isolationMarker.equals,
        )
      ) {
        isolationMismatchCount += 1;
        errors.push({
          organizationId: organization.id,
          operation: 'public:check-isolation',
          reason: 'supplier link tenant marker mismatch',
          isolationOnly: true,
        });
        return;
      }
      const submission = await boundedRequest({
        origin: config.origin,
        path: '/api/public/quote',
        method: 'POST',
        headers: requestHeaders(config.origin, {
          'content-type': 'application/json',
          cookie,
        }),
        body: JSON.stringify(organization.supplierQuote.submission),
        timeoutMs: config.timeoutMs,
      });
      if (submission.poolSignal) poolSaturationSignalCount += 1;
      if (!submission.ok || submission.status !== 201) {
        errors.push({
          organizationId: organization.id,
          operation: 'public:submit-quote',
          reason: submission.error || `HTTP ${submission.status}`,
        });
        return;
      }
      quoteSubmissionCount += 1;
    });
  }

  const after = await readinessCheck(config);
  if (!after.ok) {
    errors.push({
      organizationId: 'system',
      operation: 'readiness:after',
      reason: after.error || `HTTP ${after.status}`,
    });
  }
  if (after.poolSignal) poolSaturationSignalCount += 1;

  const isolationErrors = errors.filter((error) => error.isolationOnly).length;
  const errorCount = errors.length - isolationErrors;
  const metrics = {
    organizationCount: config.fixture.organizations.length,
    errorCount,
    isolationMismatchCount,
    authenticatedDurationsMs,
    authenticatedReadCount: authenticatedDurationsMs.length,
    quoteSubmissionCount,
    poolSaturationSignalCount,
  };
  return {
    metrics,
    evaluation: evaluateThresholds(metrics),
    errors,
  };
}

function integerOption(value, fallback, minimum, maximum, label) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

async function loadFixture(path) {
  if (!path) throw new Error('LOAD_FIXTURE_FILE is required.');
  const bytes = await readFile(path);
  if (bytes.byteLength > MAX_FIXTURE_BYTES) {
    throw new Error('LOAD_FIXTURE_FILE exceeds the 512 KB safety limit.');
  }
  let fixture;
  try {
    fixture = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('LOAD_FIXTURE_FILE must contain valid JSON.');
  }
  return validateFixture(fixture);
}

function rounded(value) {
  return value === null ? 'n/a' : `${Math.round(value * 10) / 10} ms`;
}

function printResult(config, result) {
  console.log('QuotePlate bounded 20-organization launch profile');
  console.log(`Target: ${config.targetEnvironment} (${config.origin})`);
  console.log(`Concurrency: ${config.concurrency}; retries: 0; duration loop: disabled`);
  console.log(`Organizations: ${result.metrics.organizationCount}/20`);
  console.log(`Authenticated reads: ${result.metrics.authenticatedReadCount}`);
  console.log(`Authenticated p95: ${rounded(result.evaluation.authenticatedP95Ms)} (<800 ms required)`);
  console.log(`Public quote submissions: ${result.metrics.quoteSubmissionCount}/20`);
  console.log(`Request errors: ${result.metrics.errorCount}`);
  console.log(`Isolation mismatches: ${result.metrics.isolationMismatchCount}`);
  console.log(`Readiness/timeout/503 signals: ${result.metrics.poolSaturationSignalCount}`);
  for (const error of result.errors) {
    console.error(
      `FAIL ${error.organizationId} ${error.operation}: ${error.reason}`,
    );
  }
  for (const reason of result.evaluation.reasons) console.error(`THRESHOLD ${reason}`);
  console.log(`RESULT: ${result.evaluation.pass ? 'PASS' : 'FAIL'}`);
}

async function main(environment = process.env) {
  if (!environment.LOAD_BASE_URL) throw new Error('LOAD_BASE_URL is required.');
  const target = validateTarget(environment.LOAD_BASE_URL, environment);
  const fixture = await loadFixture(environment.LOAD_FIXTURE_FILE);
  const config = {
    ...target,
    fixture,
    concurrency: integerOption(
      environment.LOAD_CONCURRENCY,
      MAX_CONCURRENCY,
      1,
      MAX_CONCURRENCY,
      'LOAD_CONCURRENCY',
    ),
    timeoutMs: integerOption(
      environment.LOAD_REQUEST_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      1_000,
      30_000,
      'LOAD_REQUEST_TIMEOUT_MS',
    ),
  };
  const result = await runProfile(config);
  printResult(config, result);
  if (!result.evaluation.pass) process.exitCode = 1;
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`LOAD PROFILE REFUSED: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  });
}

module.exports = {
  evaluateThresholds,
  main,
  percentile,
  runProfile,
  validateFixture,
  validateTarget,
};
