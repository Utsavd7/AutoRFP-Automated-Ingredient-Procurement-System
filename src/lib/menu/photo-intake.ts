export const MAX_MENU_IMAGES = 10;
export const MAX_MENU_IMAGE_BYTES = 8 * 1_024 * 1_024;
export const MAX_MENU_IMAGE_PIXELS = 20_000_000;
export const MAX_MENU_IMAGE_EDGE = 8_000;

const SUPPORTED_MENU_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export type MenuPhotoCandidate = {
  name: string;
  size: number;
  type: string;
};

export type MenuImageDimensions = {
  width: number;
  height: number;
};

export type RecognizedMenuLine = {
  text: string;
  confidence: number;
};

const LEADING_MENU_MARKER = /^(?:[\u2022\u00b7\u25cf\u25e6\u25aa\u25ab*-]+\s*|\d{1,3}\s*[.)]\s*)/;
const PRICE = /(?:₹\s*|(?:rs\.?|inr)\s*)\d+(?:\.\d{1,2})?/i;
const PRICE_AMOUNT = /(?:₹\s*|(?:rs\.?|inr)\s*)?\d+(?:\.\d{1,2})?/i;
const BARE_PRICE = /\b(?:1\d{2}|[2-9]\d{2,})(?:\.\d{1,2})?\s*$/;
const CATEGORY_HEADING = /^(?:veg(?:etarian)?\s+)?(?:starters?|appeti[sz]ers?|soups?|salads?|mains?|main\s+course|curr(?:y|ies)|tandoori|breads?|rice|noodles?|pasta|pizza|burgers?|sandwiches|desserts?|beverages?|drinks?|mocktails?|cocktails?|tea|coffee|breakfast|combos?|thalis?|sweets?|non[ -]?veg|specials?|chef'?s\s+specials?|signature\s+dishes|menu)$/i;
const METADATA = /\b(?:gst|tax(?:es)?|phone|mobile|contact|call|whatsapp|order\s+(?:now|online)|available\s+on|swiggy|zomato|home\s+delivery|dine[ -]?in|takeaway|timings?|hours?|address)\b/i;
const DESCRIPTION = /^(?:served\s+with|made\s+with|choice\s+of)\b/i;

function isPriceOnly(text: string) {
  return new RegExp(`^${PRICE.source}\\s*(?:\\/-)?$`, 'i').test(text) || /^\d+(?:\.\d{1,2})?\s*\/?-?$/.test(text);
}

function stripTrailingPrices(text: string) {
  let cleaned = text;
  // Menus commonly put two size prices after a dish, e.g. "Half 180 Full 320".
  cleaned = cleaned.replace(new RegExp(`\\s+(?:half|full)\\s+${PRICE_AMOUNT.source}(?:\\s+(?:half|full)\\s+${PRICE_AMOUNT.source})*\\s*$`, 'i'), '');
  cleaned = cleaned.replace(new RegExp(`\\s+${PRICE.source}\\s*(?:\\/-)?\\s*$`, 'i'), '');
  cleaned = cleaned.replace(/\s+\d+(?:\.\d{1,2})?\s*\/-\s*$/, '');
  return cleaned.replace(BARE_PRICE, '').trim();
}

/**
 * Removes high-confidence menu OCR noise while retaining uncertain dish names.
 */
export function cleanRecognizedMenuLines(
  lines: readonly RecognizedMenuLine[],
): RecognizedMenuLine[] {
  const seen = new Set<string>();
  const cleaned: RecognizedMenuLine[] = [];

  for (const line of lines) {
    let text = line.text.replace(/\s+/g, ' ').trim().replace(LEADING_MENU_MARKER, '').trim();
    if (
      text.length === 0 ||
      /^[^\p{L}\p{N}]+$/u.test(text) ||
      isPriceOnly(text) ||
      CATEGORY_HEADING.test(text) ||
      DESCRIPTION.test(text) ||
      METADATA.test(text) ||
      (/\bopen\b.*\b(?:am|pm)\b/i.test(text)) ||
      (/^\d+\s+.*\b(?:road|rd\.?|street|st\.?|lane|nagar|colony)\b/i.test(text)) ||
      /(?:\+?\d[\d\s()-]*){10,}/.test(text)
    ) continue;

    text = stripTrailingPrices(text);
    if (!/\p{L}/u.test(text)) continue;

    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push({ text, confidence: line.confidence });
  }

  return cleaned;
}

export function mergeMenuPhotoFiles<T>(
  current: readonly T[],
  incoming: readonly T[],
) {
  return [...current, ...incoming];
}

export function photoIntakeModeFromSearch(search: string) {
  return new URLSearchParams(search).get('menuIntake') === 'photo'
    ? 'photo' as const
    : undefined;
}

export async function validateMenuPhotoSelection<T extends MenuPhotoCandidate>(
  photos: readonly T[],
  readDimensions: (photo: T) => Promise<MenuImageDimensions>,
) {
  if (photos.length === 0 || photos.length > MAX_MENU_IMAGES) {
    throw new Error('Choose between 1 and up to 10 menu photos.');
  }

  for (const photo of photos) {
    if (!SUPPORTED_MENU_IMAGE_TYPES.has(photo.type)) {
      throw new Error(`${photo.name} must be a JPG, PNG, or WebP image.`);
    }
    if (!Number.isSafeInteger(photo.size) || photo.size <= 0) {
      throw new Error(`${photo.name} is empty or could not be read.`);
    }
    if (photo.size > MAX_MENU_IMAGE_BYTES) {
      throw new Error(`${photo.name} must be 8 MB or smaller.`);
    }
  }

  for (const photo of photos) {
    const { width, height } = await readDimensions(photo);
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      width > MAX_MENU_IMAGE_EDGE ||
      height > MAX_MENU_IMAGE_EDGE ||
      width * height > MAX_MENU_IMAGE_PIXELS
    ) {
      throw new Error(
        `${photo.name} must be 20 million pixels or fewer, with each side no longer than 8,000 pixels.`,
      );
    }
  }

  return [...photos];
}

function boundedConfidence(value: number | undefined) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(1, Math.max(0, value!)) * 10_000) / 10_000;
}

export function buildReviewedOcrMenuInput(
  reviewedText: string,
  confidences: readonly number[],
) {
  const lines = reviewedText
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text, index) => ({
      text,
      confidence: boundedConfidence(confidences[index]),
    }));
  const menuText = lines.map((line) => line.text).join('\n');

  return {
    menuText,
    source: {
      kind: 'OCR' as const,
      documentKind: 'MENU' as const,
      lines,
    },
  };
}
