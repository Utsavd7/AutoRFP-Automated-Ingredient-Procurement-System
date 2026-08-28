import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

import { expect, test } from '@playwright/test';

const execute = promisify(execFile);
const applicationOrigin = 'http://127.0.0.1:52560';
const gatewayOrigin = 'http://127.0.0.1:52562';

test('passes the bounded real 20-organization launch profile', async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One bounded profile is enough per build.');
  test.setTimeout(120_000);
  const fixturePath = testInfo.outputPath('private-load-fixture.json');
  const runnerEnvironment = { ...process.env };
  delete runnerEnvironment.NO_COLOR;
  await mkdir(dirname(fixturePath), { recursive: true });
  try {
    const seeded = await request.post(`${gatewayOrigin}/__test/database/load-organizations`);
    expect(seeded.status()).toBe(201);
    await writeFile(fixturePath, JSON.stringify(await seeded.json()), { mode: 0o600 });
    const { stdout, stderr } = await execute(
      process.execPath,
      ['tests/load/organizations.js'],
      {
        cwd: process.cwd(),
        env: {
          ...runnerEnvironment,
          LOAD_BASE_URL: applicationOrigin,
          LOAD_FIXTURE_FILE: fixturePath,
          LOAD_CONCURRENCY: '4',
          LOAD_TIMEOUT_MS: '10000',
        },
        maxBuffer: 1024 * 1024,
        timeout: 90_000,
      },
    );
    expect(stderr).toBe('');
    expect(stdout).toContain('PASS');
    expect(stdout).toMatch(/Organizations:\s+20\/20/);
    expect(stdout).toMatch(/Public quote submissions:\s+20\/20/);
    expect(stdout).toMatch(/Request errors:\s+0/);
    expect(stdout).toMatch(/Isolation mismatches:\s+0/);
  } finally {
    await rm(fixturePath, { force: true });
  }
});
