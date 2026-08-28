import {
  localPilotTestModeAllowed,
  pilotEmailAllowed,
  productionEmailOwnerSignupAllowed,
} from '@/lib/auth/pilot-access';

const localProduction = {
  NODE_ENV: 'production',
  NEXTAUTH_URL: 'http://127.0.0.1:52560',
  DATABASE_URL: 'postgresql://autorfp_app:test@127.0.0.1:5432/quoteplate',
  QUOTEPLATE_LOCAL_E2E: '1',
};

test('permits disposable owner signup only in an explicit all-loopback test environment', () => {
  expect(localPilotTestModeAllowed(localProduction)).toBe(true);
  expect(pilotEmailAllowed('disposable@example.test', localProduction)).toBe(true);
  expect(productionEmailOwnerSignupAllowed(localProduction)).toBe(true);
});

test.each([
  { ...localProduction, NEXTAUTH_URL: 'https://quoteplate.example' },
  { ...localProduction, DATABASE_URL: 'postgresql://app:test@db.example/quoteplate?sslmode=require' },
  { ...localProduction, QUOTEPLATE_LOCAL_E2E: undefined },
])('never enables the test bypass outside an explicit all-loopback environment', (environment) => {
  expect(localPilotTestModeAllowed(environment)).toBe(false);
  expect(pilotEmailAllowed('disposable@example.test', environment)).toBe(false);
  expect(productionEmailOwnerSignupAllowed(environment)).toBe(false);
});
