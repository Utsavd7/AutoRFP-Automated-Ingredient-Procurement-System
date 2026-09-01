export const MAX_MENU_IMAGES = 5;
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
    throw new Error('Choose between 1 and up to 5 menu photos.');
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
