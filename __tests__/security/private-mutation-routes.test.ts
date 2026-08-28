import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Guard = 'browserJsonMutationRejection' | 'browserMutationOriginRejection';

const routes: ReadonlyArray<{
  label: string;
  file: string;
  guard: Guard;
  requestName: string;
}> = [
  { label: 'create menu', file: 'src/app/api/menus/route.ts', guard: 'browserJsonMutationRejection', requestName: 'request' },
  { label: 'update menu', file: 'src/app/api/menus/[id]/route.ts', guard: 'browserJsonMutationRejection', requestName: 'request' },
  { label: 'approve menu', file: 'src/app/api/menus/[id]/approve/route.ts', guard: 'browserJsonMutationRejection', requestName: 'request' },
  { label: 'parse menu', file: 'src/app/api/parse-menu/route.ts', guard: 'browserJsonMutationRejection', requestName: 'req' },
  { label: 'create request', file: 'src/app/api/requests/route.ts', guard: 'browserJsonMutationRejection', requestName: 'request' },
  { label: 'update request', file: 'src/app/api/requests/[id]/route.ts', guard: 'browserJsonMutationRejection', requestName: 'request' },
  { label: 'open request', file: 'src/app/api/requests/[id]/open/route.ts', guard: 'browserJsonMutationRejection', requestName: 'request' },
  { label: 'change request link', file: 'src/app/api/requests/[id]/links/route.ts', guard: 'browserJsonMutationRejection', requestName: 'request' },
  { label: 'create supplier', file: 'src/app/api/suppliers/route.ts', guard: 'browserJsonMutationRejection', requestName: 'request' },
  { label: 'update supplier', file: 'src/app/api/suppliers/[id]/route.ts', guard: 'browserJsonMutationRejection', requestName: 'request' },
  { label: 'deactivate supplier', file: 'src/app/api/suppliers/[id]/route.ts', guard: 'browserMutationOriginRejection', requestName: 'request' },
  { label: 'import suppliers', file: 'src/app/api/suppliers/import/route.ts', guard: 'browserMutationOriginRejection', requestName: 'request' },
];

function source(file: string) {
  return readFileSync(resolve(process.cwd(), file), 'utf8');
}

describe('private browser mutation route matrix', () => {
  it.each(routes)('$label checks $guard before account or business work', ({ file, guard, requestName }) => {
    const code = source(file);
    const check = `${guard}(${requestName})`;
    const checkAt = code.indexOf(check);
    const accountAt = code.indexOf('requireAccountContext()', checkAt);

    expect(checkAt).toBeGreaterThan(-1);
    expect(accountAt).toBeGreaterThan(checkAt);
    expect(code).toContain('privateMutationResponse');
  });

  it('protects workspace signup before parsing or quota work', () => {
    const code = source('src/lib/auth/start-handler.ts');
    const checkAt = code.indexOf('browserJsonMutationRejection(request');

    expect(checkAt).toBeGreaterThan(-1);
    expect(code.indexOf('readBoundedJson(request', checkAt)).toBeGreaterThan(checkAt);
    expect(code.indexOf('dependencies.rateLimit(', checkAt)).toBeGreaterThan(checkAt);
    expect(code).toContain('privateMutationResponse');
  });
});
