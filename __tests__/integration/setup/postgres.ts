import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from 'testcontainers';

const POSTGRES_IMAGE = 'postgres:16.4-alpine';
const POSTGRES_PORT = 5432;
const CONTAINER_STARTUP_TIMEOUT_MS = 60_000;
const PRISMA_COMMAND_TIMEOUT_MS = 45_000;
const projectRoot = path.resolve(__dirname, '../../..');
const prismaCli = path.join(projectRoot, 'node_modules/prisma/build/index.js');
const prismaSchema = path.join(projectRoot, 'prisma/schema.prisma');

function runPrisma(args: string[], databaseUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [prismaCli, ...args], {
      cwd: projectRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        NO_COLOR: '1',
      },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, PRISMA_COMMAND_TIMEOUT_MS);

    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);

      if (timedOut) {
        reject(new Error(`Prisma command timed out after ${PRISMA_COMMAND_TIMEOUT_MS}ms`));
        return;
      }

      if (code !== 0) {
        reject(
          new Error(
            `Prisma command failed with exit code ${code}\n${stdout}${stderr}`.trim(),
          ),
        );
        return;
      }

      resolve();
    });
  });
}

async function deployMigrations(databaseUrl: string): Promise<void> {
  await runPrisma(['migrate', 'deploy', '--schema', prismaSchema], databaseUrl);
  await runPrisma(
    [
      'migrate',
      'diff',
      '--from-schema-datasource',
      prismaSchema,
      '--to-schema-datamodel',
      prismaSchema,
      '--exit-code',
    ],
    databaseUrl,
  );
}

export async function withMigratedPostgres(
  run: (databaseUrl: string) => Promise<void>,
): Promise<void> {
  const username = 'autorfp';
  const database = 'autorfp_test';
  const password = randomBytes(24).toString('hex');
  let container: StartedTestContainer | undefined;

  try {
    container = await new GenericContainer(POSTGRES_IMAGE)
      .withEnvironment({
        POSTGRES_DB: database,
        POSTGRES_PASSWORD: password,
        POSTGRES_USER: username,
      })
      .withExposedPorts(POSTGRES_PORT)
      .withWaitStrategy(
        Wait.forLogMessage(
          /database system is ready to accept connections/,
          2,
        ),
      )
      .withStartupTimeout(CONTAINER_STARTUP_TIMEOUT_MS)
      .start();

    const host = container.getHost();
    const urlHost = host.includes(':') ? `[${host}]` : host;
    const databaseUrl =
      `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}` +
      `@${urlHost}:${container.getMappedPort(POSTGRES_PORT)}` +
      `/${encodeURIComponent(database)}?schema=public`;

    await deployMigrations(databaseUrl);
    await run(databaseUrl);
  } finally {
    await container?.stop();
  }
}
