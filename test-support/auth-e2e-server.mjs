import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';

import { startAuthGateway } from './auth-e2e-gateway.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const appPort = 52_560;
const localAuthPort = 52_562;
const e2eDist = join(projectRoot, '.next-auth-e2e');
const e2eSupport = join(projectRoot, '.auth-e2e-support');
const prismaCli = join(projectRoot, 'node_modules/prisma/build/index.js');
const prismaSchema = join(projectRoot, 'prisma/schema.prisma');
const nextCli = join(projectRoot, 'node_modules/next/dist/bin/next');

let temporaryRoot;
let postgresProcess;
let appProcess;
let gatewayServer;
let adminClient;
let closing = false;

function reservePort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a PostgreSQL port'));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolvePort(address.port);
      });
    });
  });
}

function run(command, args, env = process.env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: { ...env, NO_COLOR: '1' },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} exited with ${code}\n${output}`));
    });
  });
}

function waitForPostgres(child) {
  return new Promise((resolveReady, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      reject(new Error(`PostgreSQL did not become ready\n${output}`));
    }, 20_000);
    const inspect = (chunk) => {
      output += chunk;
      if (output.includes('database system is ready to accept connections')) {
        clearTimeout(timeout);
        resolveReady();
      }
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', inspect);
    child.stderr.on('data', inspect);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      reject(new Error(`PostgreSQL exited before startup with ${code}\n${output}`));
    });
  });
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const closed = new Promise((resolveClose) => child.once('close', resolveClose));
  child.kill('SIGTERM');
  const forced = setTimeout(() => child.kill('SIGKILL'), 5_000);
  await closed;
  clearTimeout(forced);
}

async function stopServer(server) {
  if (!server?.listening) return;
  server.closeAllConnections();
  await new Promise((resolveClose) => server.close(resolveClose));
}

async function shutdown(code) {
  if (closing) return;
  closing = true;
  await stopServer(gatewayServer);
  await stop(appProcess);
  if (adminClient) await adminClient.$disconnect();
  await stop(postgresProcess);
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  await rm(e2eDist, { recursive: true, force: true });
  await rm(e2eSupport, { recursive: true, force: true });
  process.exit(code);
}

async function main() {
  await rm(e2eDist, { recursive: true, force: true });
  await rm(e2eSupport, { recursive: true, force: true });
  temporaryRoot = await mkdtemp(join(tmpdir(), 'quoteplate-auth-e2e-'));
  const dataDirectory = join(temporaryRoot, 'data');
  const socketDirectory = join(temporaryRoot, 'socket');
  const postgresPort = await reservePort();
  await mkdir(socketDirectory);

  await run('initdb', [
    '--auth=trust',
    '--encoding=UTF8',
    '--no-locale',
    '--username=autorfp',
    '-D',
    dataDirectory,
  ]);

  postgresProcess = spawn(
    'postgres',
    [
      '-D', dataDirectory,
      '-h', '127.0.0.1',
      '-p', String(postgresPort),
      '-k', socketDirectory,
    ],
    {
      cwd: projectRoot,
      env: { ...process.env, NO_COLOR: '1' },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  await waitForPostgres(postgresProcess);

  const adminDatabaseUrl =
    `postgresql://autorfp@127.0.0.1:${postgresPort}/postgres?schema=public`;
  await run(
    process.execPath,
    [prismaCli, 'migrate', 'deploy', '--schema', prismaSchema],
    {
      ...process.env,
      DATABASE_URL: adminDatabaseUrl,
      DIRECT_URL: adminDatabaseUrl,
    },
  );

  const appPassword = randomBytes(24).toString('hex');
  adminClient = new PrismaClient({
    datasources: { db: { url: adminDatabaseUrl } },
  });
  await adminClient.$executeRawUnsafe(
    `ALTER ROLE autorfp_app PASSWORD '${appPassword}'`,
  );

  const appDatabaseUrl =
    `postgresql://autorfp_app:${appPassword}@127.0.0.1:${postgresPort}` +
    '/postgres?schema=public';
  const liveGoogle = process.env.AUTH_E2E_LIVE_GOOGLE === '1';
  const appEnv = {
    ...process.env,
    DATABASE_URL: appDatabaseUrl,
    DIRECT_URL: adminDatabaseUrl,
    NEXTAUTH_URL: `http://127.0.0.1:${appPort}`,
    NEXTAUTH_SECRET: 'quoteplate-local-browser-test-secret-2026',
    NEXT_DIST_DIR: '.next-auth-e2e',
    QUOTEPLATE_LOCAL_E2E: '1',
  };
  if (!liveGoogle) {
    appEnv.GOOGLE_CLIENT_ID = 'local-google-client';
    appEnv.GOOGLE_CLIENT_SECRET = 'local-google-secret';
  }

  Object.assign(process.env, appEnv);

  await run(
    process.execPath,
    [nextCli, 'build', '--webpack'],
    appEnv,
  );

  appProcess = spawn(
    process.execPath,
    [nextCli, 'start', '-H', '127.0.0.1', '-p', String(appPort)],
    {
      cwd: projectRoot,
      env: appEnv,
      shell: false,
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );
  appProcess.once('error', (error) => {
    console.error(error);
    void shutdown(1);
  });
  appProcess.once('close', (code) => void shutdown(code ?? 1));

  if (!liveGoogle) {
    gatewayServer = await startAuthGateway({
      admin: adminClient,
      appPort,
      gatewayPort: localAuthPort,
      liveGoogle,
      projectRoot,
      supportDirectory: e2eSupport,
    });
  }
}

process.once('SIGINT', () => void shutdown(130));
process.once('SIGTERM', () => void shutdown(0));
process.once('SIGHUP', () => void shutdown(0));

main().catch((error) => {
  console.error(error);
  void shutdown(1);
});
