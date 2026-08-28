import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import { BrandMark } from '@/components/brand/BrandMark';

const viewBox = '0 0 34 40';
const requestPath = 'M3 3h14v17h-4v10L3 27V3Z';
const quotePath = 'M20 9 30 12v23H20V23h-3v-3h3V9Z';

const assetPaths = [
  'public/brand/mark-duotone.svg',
  'public/brand/mark-ink.svg',
  'public/brand/app-icon.svg',
  'public/brand/wordmark-horizontal.svg',
  'src/app/icon.svg',
];

describe('QuotePlate approved logo construction', () => {
  it('renders the tall, stepped two-block mark used in the approved brand design', () => {
    const markup = renderToStaticMarkup(<BrandMark />);

    expect(markup).toContain(`viewBox="${viewBox}"`);
    expect(markup).toContain(`d="${requestPath}"`);
    expect(markup).toContain(`d="${quotePath}"`);
  });

  it.each(assetPaths)('%s uses the same approved two-block geometry', (assetPath) => {
    const svg = fs.readFileSync(path.join(process.cwd(), assetPath), 'utf8');

    expect(svg).toContain(requestPath);
    expect(svg).toContain(quotePath);
  });
});
