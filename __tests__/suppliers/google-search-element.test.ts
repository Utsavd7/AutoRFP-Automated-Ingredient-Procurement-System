import { runInNewContext } from 'node:vm';

import { supplierSearchDocument, supplierSearchEngineId, SUPPLIER_SEARCH_SANDBOX } from '@/lib/suppliers/google-search-element';

describe('isolated Google supplier search', () => {
  it.each([undefined, '', 'bad', '<script>', 'abcde?key=secret', 'abcde/redirect', 'abcde"onload=', 'a'.repeat(101)])('rejects unsafe or missing engine configuration: %s', (value) => {
    expect(supplierSearchEngineId(value)).toBeNull();
  });

  it('accepts current and legacy public engine identifiers', () => {
    expect(supplierSearchEngineId(' a1b2c3d4e5f6g7h8 ')).toBe('a1b2c3d4e5f6g7h8');
    expect(supplierSearchEngineId('123456789012345678901:example_id')).toBe('123456789012345678901:example_id');
  });

  it('never grants same-origin, top-navigation or form permissions to Google code', () => {
    expect(SUPPLIER_SEARCH_SANDBOX.split(' ')).toEqual(['allow-scripts', 'allow-popups', 'allow-popups-to-escape-sandbox']);
  });

  it('keeps script terminators and Unicode inside the query without executing injected markup', () => {
    const query = 'पनीर </script><script>parent.stolen=true</script>\u2028\u2029 & Mumbai';
    const html = supplierSearchDocument('test_engine', query)!;
    expect(html).not.toContain(query);
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    const execute = jest.fn();
    const appendChild = jest.fn();
    const context = {
      window: {} as { __gcse?: { initializationCallback: () => void } },
      parent: { postMessage: jest.fn() },
      document: { createElement: () => ({}), head: { appendChild } },
      google: { search: { cse: { element: { render: jest.fn(), getElement: () => ({ execute }) } } } },
      setTimeout: jest.fn(), clearTimeout: jest.fn(),
    };
    runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)![1], context);
    expect(appendChild).toHaveBeenCalledWith(expect.objectContaining({ src: 'https://cse.google.com/cse.js?cx=test_engine', async: true }));
    expect(execute).not.toHaveBeenCalled();
    context.window.__gcse!.initializationCallback();
    expect(execute).toHaveBeenCalledWith(query);
    expect(context.parent).not.toHaveProperty('stolen');
  });

  it('does not build a widget for missing queries or invalid configuration', () => {
    expect(supplierSearchDocument('invalid?id', 'Paneer Mumbai')).toBeNull();
    expect(supplierSearchDocument('valid_id', '  ')).toBeNull();
    expect(supplierSearchDocument('valid_id', 'a'.repeat(1001))).toBeNull();
  });
});
