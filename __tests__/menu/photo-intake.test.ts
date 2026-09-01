import {
  buildReviewedOcrMenuInput,
  MAX_MENU_IMAGE_BYTES,
  MAX_MENU_IMAGE_PIXELS,
  mergeMenuPhotoFiles,
  photoIntakeModeFromSearch,
  validateMenuPhotoSelection,
} from '@/lib/menu/photo-intake';

function photo(overrides: Partial<{ name: string; size: number; type: string }> = {}) {
  return {
    name: 'menu.jpg',
    size: 2_000_000,
    type: 'image/jpeg',
    ...overrides,
  };
}

describe('local menu photo intake', () => {
  it('keeps earlier phone photos when another capture is added', () => {
    const first = photo({ name: 'front.jpg' });
    const second = photo({ name: 'back.jpg' });

    expect(mergeMenuPhotoFiles([first], [second])).toEqual([first, second]);
  });

  it('accepts at most five bounded images and checks decoded pixels before OCR', async () => {
    const dimensions = jest.fn().mockResolvedValue({ width: 4_000, height: 3_000 });

    await expect(validateMenuPhotoSelection(
      [photo(), photo(), photo(), photo(), photo()],
      dimensions,
    )).resolves.toHaveLength(5);
    expect(dimensions).toHaveBeenCalledTimes(5);

    dimensions.mockClear();
    await expect(validateMenuPhotoSelection(
      [photo(), photo(), photo(), photo(), photo(), photo()],
      dimensions,
    )).rejects.toThrow('up to 5');
    expect(dimensions).not.toHaveBeenCalled();
  });

  it('rejects unsupported, oversized, and over pixel images before OCR', async () => {
    const dimensions = jest.fn().mockResolvedValue({
      width: MAX_MENU_IMAGE_PIXELS + 1,
      height: 1,
    });

    await expect(validateMenuPhotoSelection(
      [photo({ type: 'image/svg+xml' })],
      dimensions,
    )).rejects.toThrow('JPG, PNG, or WebP');
    await expect(validateMenuPhotoSelection(
      [photo({ size: MAX_MENU_IMAGE_BYTES + 1 })],
      dimensions,
    )).rejects.toThrow('8 MB or smaller');
    expect(dimensions).not.toHaveBeenCalled();

    await expect(validateMenuPhotoSelection([photo()], dimensions))
      .rejects.toThrow('20 million pixels or fewer');
    expect(dimensions).toHaveBeenCalledTimes(1);
  });

  it('builds the existing reviewed OCR API contract without image data', () => {
    const input = buildReviewedOcrMenuInput(
      'Paneer tikka\nDal makhani',
      [0.94, 0.71],
    );

    expect(input).toEqual({
      menuText: 'Paneer tikka\nDal makhani',
      source: {
        kind: 'OCR',
        documentKind: 'MENU',
        lines: [
          { text: 'Paneer tikka', confidence: 0.94 },
          { text: 'Dal makhani', confidence: 0.71 },
        ],
      },
    });
    expect(JSON.stringify(input)).not.toContain('data:image');
  });

  it('opens photo mode only for the explicit phone query flag', () => {
    expect(photoIntakeModeFromSearch('?menuIntake=photo')).toBe('photo');
    expect(photoIntakeModeFromSearch('?menuIntake=text')).toBeUndefined();
    expect(photoIntakeModeFromSearch('?other=photo')).toBeUndefined();
  });
});
