export type RestaurantSampleItem = {
  name: string;
  quantity: number;
  unit: 'kg' | 'L';
  sampleRatePaise: number;
};

export type RestaurantSampleQuote = {
  supplierName: string;
  subtotalPaise: number;
  gstPaise: number;
  freightPaise: number;
  totalPaise: number;
  coverageCount: number;
  delivery: string;
  terms: string;
  status: 'Submitted';
};

export const restaurantSampleRequest = {
  id: 'QP-1042',
  context: 'Indiranagar, Bengaluru · ~100 covers/day',
  cadence: '7-day kitchen order',
  delivery: 'Next morning',
  items: [
    { name: 'Tomato, red', quantity: 38, unit: 'kg', sampleRatePaise: 4_200 },
    { name: 'Onion, red', quantity: 24, unit: 'kg', sampleRatePaise: 3_650 },
    { name: 'Paneer', quantity: 16, unit: 'kg', sampleRatePaise: 34_000 },
    { name: 'Chicken, curry cut', quantity: 45, unit: 'kg', sampleRatePaise: 22_000 },
    { name: 'Basmati rice', quantity: 60, unit: 'kg', sampleRatePaise: 9_500 },
    { name: 'Sunflower oil', quantity: 30, unit: 'L', sampleRatePaise: 13_500 },
    { name: 'Potato', quantity: 40, unit: 'kg', sampleRatePaise: 3_000 },
    { name: 'Coriander', quantity: 3, unit: 'kg', sampleRatePaise: 12_000 },
  ] satisfies RestaurantSampleItem[],
} as const;

export const restaurantSampleQuotes = [
  {
    supplierName: 'Annapurna Foodservice',
    subtotalPaise: 2_912_200,
    gstPaise: 75_950,
    freightPaise: 45_000,
    totalPaise: 3_033_150,
    coverageCount: 8,
    delivery: 'Next day · 7:00 AM',
    terms: '15 days',
    status: 'Submitted',
  },
  {
    supplierName: 'City Fresh Trading Co.',
    subtotalPaise: 2_881_000,
    gstPaise: 71_200,
    freightPaise: 42_500,
    totalPaise: 2_994_700,
    coverageCount: 7,
    delivery: 'Next day · 9:00 AM',
    terms: '7 days',
    status: 'Submitted',
  },
  {
    supplierName: 'Deccan Kitchen Supply',
    subtotalPaise: 2_990_500,
    gstPaise: 78_125,
    freightPaise: 60_000,
    totalPaise: 3_128_625,
    coverageCount: 8,
    delivery: 'Next day · 7:30 AM',
    terms: '30 days',
    status: 'Submitted',
  },
] satisfies RestaurantSampleQuote[];

export function formatSampleInr(paise: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}
