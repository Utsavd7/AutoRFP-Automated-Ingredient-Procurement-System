const KIBIBYTE = 1024;
const MEBIBYTE = KIBIBYTE * KIBIBYTE;

export const DOCUMENT_LIMITS = {
  itemSpecification: {
    thumbnailDecodedBytes: 48 * KIBIBYTE,
    referenceUrlCharacters: 2048,
  },
  menu: {
    jsonBytes: 512 * KIBIBYTE,
    dishes: 250,
    ingredients: 1000,
  },
  supplierCapabilities: {
    jsonBytes: 64 * KIBIBYTE,
    itemPreferences: 250,
  },
  requestItems: {
    jsonBytes: 512 * KIBIBYTE,
    items: 250,
  },
  selectedSuppliers: 20,
  quoteRevisions: {
    jsonBytes: 2 * MEBIBYTE,
    revisions: 10,
  },
  awardLines: {
    jsonBytes: 2 * MEBIBYTE,
    lines: 2000,
  },
  thumbnails: {
    perDocument: 8,
    decodedBytesPerDocument: 256 * KIBIBYTE,
    decodedBytesPerTenant: 4 * MEBIBYTE,
  },
} as const;
