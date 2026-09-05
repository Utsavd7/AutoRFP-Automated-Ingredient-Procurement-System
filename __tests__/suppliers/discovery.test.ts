import { buildSupplierDiscoveryLinks, SUPPLIER_DISCOVERY_SOURCES } from '@/lib/suppliers/discovery';

const input = {
  ingredient: 'Paneer', locality: 'Andheri East', city: 'Mumbai', state: 'Maharashtra', pin: '400069',
};

describe('free external supplier discovery', () => {
  it('includes all eight sources and retains the chosen area in every query', () => {
    const result = buildSupplierDiscoveryLinks(input)!;
    expect(result.links.map((link) => link.name)).toEqual([
      'Google Maps', 'Google Search', 'Justdial', 'IndiaMART', 'TradeIndia',
      'ExportersIndia', 'Kompass India', 'go4WorldBusiness',
    ]);
    expect(result.query).toBe('Paneer supplier in Andheri East, Mumbai, Maharashtra, 400069, India');
    for (const link of result.links) {
      const url = new URL(link.url);
      expect(url.origin).toBe('https://www.google.com');
      expect(url.searchParams.get(link.id === 'maps' ? 'query' : 'q')).toContain(result.query);
      expect(url.searchParams.has('key')).toBe(false);
    }
    const maps = new URL(result.links[0].url);
    expect(maps.pathname).toBe('/maps/search/');
    expect(maps.searchParams.get('api')).toBe('1');
  });

  it('restricts directory queries to the chosen source using Google site search', () => {
    const result = buildSupplierDiscoveryLinks(input)!;
    for (const source of SUPPLIER_DISCOVERY_SOURCES.filter((source) => source.domain)) {
      const url = new URL(result.links.find((link) => link.id === source.id)!.url);
      expect(url.pathname).toBe('/search');
      expect(url.searchParams.get('q')).toBe(`site:${source.domain} ${result.query}`);
    }
  });

  it('normalizes whitespace and accepts city-only searches without inventing a locality or PIN', () => {
    const result = buildSupplierDiscoveryLinks({
      ingredient: '  Grains  &  Pulses ', city: ' Navi   Mumbai ', locality: '', state: '', pin: '',
    })!;
    expect(result.query).toBe('Grains & Pulses supplier in Navi Mumbai, India');
  });

  it('encodes Unicode and reserved characters as query data, never navigation parameters', () => {
    const ingredient = 'पनीर & मसाले #fresh?redirect=https://example.com';
    const result = buildSupplierDiscoveryLinks({ ...input, ingredient })!;
    for (const link of result.links) {
      const url = new URL(link.url);
      expect(url.origin).toBe('https://www.google.com');
      expect(url.hash).toBe('');
      expect(url.searchParams.has('redirect')).toBe(false);
      expect(url.searchParams.get(link.id === 'maps' ? 'query' : 'q')).toContain(ingredient);
    }
  });

  it.each([
    { ingredient: '   ' }, { city: '\n' }, { pin: '12345' }, { pin: '000000' },
    { pin: '4000691' }, { pin: 'abcdef' }, { ingredient: 'प'.repeat(500) },
  ])('rejects incomplete, invalid or oversized searches: %j', (changes) => {
    expect(buildSupplierDiscoveryLinks({ ...input, ...changes })).toBeNull();
  });
});
