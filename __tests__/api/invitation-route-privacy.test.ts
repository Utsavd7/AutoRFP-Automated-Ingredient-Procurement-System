import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

test('acceptance posts the secret in a body to a tokenless API route', () => {
  const root = path.resolve(__dirname, '../..');
  const client = readFileSync(
    path.join(root, 'src/app/(public)/join/JoinInvitationForm.tsx'),
    'utf8',
  );

  expect(client).toContain("fetch('/api/invitations/accept'");
  expect(client).toContain("window.history.replaceState(null, '', '/join')");
  expect(client).toContain("params.get('token')");
  expect(client).not.toContain('/api/invitations/${');
  expect(
    existsSync(path.join(root, 'src/app/(public)/join/[token]/page.tsx')),
  ).toBe(false);
  expect(
    existsSync(path.join(root, 'src/app/api/invitations/[token]/accept/route.ts')),
  ).toBe(false);
  expect(
    existsSync(path.join(root, 'src/app/api/invitations/accept/route.ts')),
  ).toBe(true);
});
