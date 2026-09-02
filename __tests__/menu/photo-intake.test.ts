import {
  buildReviewedOcrMenuInput,
  cleanRecognizedMenuLines,
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

  it('accepts at most ten bounded images and checks decoded pixels before OCR', async () => {
    const dimensions = jest.fn().mockResolvedValue({ width: 4_000, height: 3_000 });
    const tenPhotos = Array.from({ length: 10 }, (_, index) => photo({
      name: `menu-${index + 1}.jpg`,
    }));

    await expect(validateMenuPhotoSelection(
      tenPhotos,
      dimensions,
    )).resolves.toHaveLength(10);
    expect(dimensions).toHaveBeenCalledTimes(10);

    dimensions.mockClear();
    await expect(validateMenuPhotoSelection(
      [...tenPhotos, photo({ name: 'menu-11.jpg' })],
      dimensions,
    )).rejects.toThrow('up to 10');
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

  it('keeps probable dishes, removes prices and service noise, and de-duplicates OCR lines', () => {
    expect(cleanRecognizedMenuLines([
      { text: '1. Paneer Tikka ₹260', confidence: 0.94 },
      { text: 'VEG STARTERS', confidence: 0.98 },
      { text: 'Chicken 65', confidence: 0.9 },
      { text: '2 in 1 Dosa 180/-', confidence: 0.84 },
      { text: 'Dal Makhani Half 180 Full 320', confidence: 0.8 },
      { text: 'Served with mint chutney', confidence: 0.7 },
      { text: 'Call 9876543210', confidence: 0.99 },
      { text: 'paneer tikka 260', confidence: 0.88 },
    ])).toEqual([
      { text: 'Paneer Tikka', confidence: 0.94 },
      { text: 'Chicken 65', confidence: 0.9 },
      { text: '2 in 1 Dosa', confidence: 0.84 },
      { text: 'Dal Makhani', confidence: 0.8 },
    ]);
  });

  it('strips common price notations and leading menu markers without changing meaningful dish numbers', () => {
    expect(cleanRecognizedMenuLines([
      { text: '• Gobi 65 Rs 180', confidence: 0.91 },
      { text: '03) Veg Pulao INR 180.00', confidence: 0.83 },
      { text: '- Masala Papad ₹180', confidence: 0.76 },
      { text: '7. Chole Bhature 180/-', confidence: 0.87 },
    ])).toEqual([
      { text: 'Gobi 65', confidence: 0.91 },
      { text: 'Veg Pulao', confidence: 0.83 },
      { text: 'Masala Papad', confidence: 0.76 },
      { text: 'Chole Bhature', confidence: 0.87 },
    ]);
  });

  it('uses multi-word dish evidence before stripping ambiguous bare prices', () => {
    expect(cleanRecognizedMenuLines([
      { text: 'Chicken 555', confidence: 0.91 },
      { text: 'Chicken 777', confidence: 0.9 },
      { text: 'Chicken 999', confidence: 0.89 },
      { text: 'Paneer Tikka 999', confidence: 0.88 },
      { text: 'Paneer Tikka 1000', confidence: 0.87 },
      { text: 'Paneer Tikka 1999', confidence: 0.86 },
      { text: 'Paneer Tikka 2000', confidence: 0.85 },
    ])).toEqual([
      { text: 'Chicken 555', confidence: 0.91 },
      { text: 'Chicken 777', confidence: 0.9 },
      { text: 'Chicken 999', confidence: 0.89 },
      { text: 'Paneer Tikka', confidence: 0.88 },
    ]);
  });

  it('cleans bounded repeated price columns and their separators', () => {
    expect(cleanRecognizedMenuLines([
      { text: 'Paneer Tikka - 300', confidence: 0.94 },
      { text: 'Paneer Tikka 180 320', confidence: 0.93 },
      { text: 'Paneer Tikka 180/320', confidence: 0.92 },
      { text: 'Paneer Tikka 180 | 320', confidence: 0.91 },
      { text: 'Chicken 555', confidence: 0.9 },
      { text: 'Chicken 999', confidence: 0.89 },
      { text: 'Chicken 65', confidence: 0.88 },
      { text: 'Gobi 65', confidence: 0.87 },
      { text: '2 in 1 Dosa', confidence: 0.86 },
    ])).toEqual([
      { text: 'Paneer Tikka', confidence: 0.94 },
      { text: 'Chicken 555', confidence: 0.9 },
      { text: 'Chicken 999', confidence: 0.89 },
      { text: 'Chicken 65', confidence: 0.88 },
      { text: 'Gobi 65', confidence: 0.87 },
      { text: '2 in 1 Dosa', confidence: 0.86 },
    ]);
  });

  it('keeps ambiguous singular menu items editable', () => {
    expect(cleanRecognizedMenuLines([
      { text: 'Tea', confidence: 0.91 },
      { text: 'Coffee', confidence: 0.9 },
      { text: 'Rice', confidence: 0.89 },
      { text: 'Pizza', confidence: 0.88 },
      { text: 'Burger', confidence: 0.87 },
      { text: 'Soup', confidence: 0.86 },
      { text: 'Salad', confidence: 0.85 },
      { text: 'Thali', confidence: 0.84 },
    ])).toEqual([
      { text: 'Tea', confidence: 0.91 },
      { text: 'Coffee', confidence: 0.9 },
      { text: 'Rice', confidence: 0.89 },
      { text: 'Pizza', confidence: 0.88 },
      { text: 'Burger', confidence: 0.87 },
      { text: 'Soup', confidence: 0.86 },
      { text: 'Salad', confidence: 0.85 },
      { text: 'Thali', confidence: 0.84 },
    ]);
  });

  it('removes common menu metadata and returns no results when every line is noise', () => {
    expect(cleanRecognizedMenuLines([
      { text: 'DESSERTS', confidence: 0.99 },
      { text: 'GST & taxes extra', confidence: 0.93 },
      { text: '12 MG Road, Pune 411001', confidence: 0.92 },
      { text: 'Phone: +91 98765 43210', confidence: 0.95 },
      { text: 'Open 11 AM to 11 PM', confidence: 0.88 },
      { text: 'Order now on Swiggy', confidence: 0.9 },
    ])).toEqual([]);
  });

  it('removes unambiguous OCR headings, contact details, hours, and descriptions', () => {
    expect(cleanRecognizedMenuLines([
      { text: 'NON-VEG STARTERS', confidence: 0.99 },
      { text: '11:00 AM - 11:00 PM', confidence: 0.98 },
      { text: 'orders@example.com', confidence: 0.97 },
      { text: 'Crispy cottage cheese tossed in spices', confidence: 0.96 },
      { text: 'Crispy Cottage Cheese', confidence: 0.9 },
      { text: 'Tossed Salad', confidence: 0.89 },
    ])).toEqual([
      { text: 'Crispy Cottage Cheese', confidence: 0.9 },
      { text: 'Tossed Salad', confidence: 0.89 },
    ]);
  });
});
