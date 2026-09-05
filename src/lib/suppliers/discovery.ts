export type SupplierDiscoveryInput = {
  ingredient: string;
  locality: string;
  city: string;
  state: string;
  pin: string;
};

export const SUPPLIER_DISCOVERY_SOURCES = [
  { id: 'maps', name: 'Google Maps', description: 'Nearby wholesalers and local shops', domain: null },
  { id: 'search', name: 'Google Search', description: 'Independent suppliers and local markets', domain: null },
  { id: 'justdial', name: 'Justdial', description: 'Local businesses and distributors', domain: 'justdial.com' },
  { id: 'indiamart', name: 'IndiaMART', description: 'Wholesalers and manufacturers', domain: 'indiamart.com' },
  { id: 'tradeindia', name: 'TradeIndia', description: 'Bulk ingredients and packaging', domain: 'tradeindia.com' },
  { id: 'exportersindia', name: 'ExportersIndia', description: 'Food and produce suppliers', domain: 'exportersindia.com' },
  { id: 'kompass', name: 'Kompass India', description: 'Established distributors; wider sourcing', domain: 'in.kompass.com' },
  { id: 'go4worldbusiness', name: 'go4WorldBusiness', description: 'Bulk sourcing; check minimum orders', domain: 'go4worldbusiness.com' },
] as const;

export function buildSupplierDiscoveryLinks(input: SupplierDiscoveryInput) {
  const clean = (value: string) => value.trim().replace(/\s+/gu, ' ');
  const ingredient = clean(input.ingredient);
  const city = clean(input.city);
  const pin = clean(input.pin);
  if (!ingredient || !city || (pin && !/^[1-9]\d{5}$/.test(pin))) return null;

  const location = [input.locality, city, input.state, pin, 'India']
    .map(clean).filter(Boolean).join(', ');
  const query = `${ingredient} supplier in ${location}`;
  const links = SUPPLIER_DISCOVERY_SOURCES.map((source) => {
    const url = new URL(source.id === 'maps'
      ? 'https://www.google.com/maps/search/'
      : 'https://www.google.com/search');
    if (source.id === 'maps') {
      // Maps URLs support external search without an API key or billing account.
      url.searchParams.set('api', '1');
      url.searchParams.set('query', query);
    } else {
      url.searchParams.set('q', source.domain ? `site:${source.domain} ${query}` : query);
    }
    return { ...source, url: url.href };
  });
  if (links.some((link) => link.url.length > 2048)) return null;
  return { query, links };
}
