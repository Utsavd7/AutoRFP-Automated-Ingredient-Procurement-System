import { formatIndiaDate, formatIndiaDeadline } from '@/lib/domain/india-date';

describe('India procurement dates', () => {
  it('keeps date-only delivery values on their intended India date', () => {
    expect(formatIndiaDate('2026-09-06')).toBe('6 Sept 2026');
  });

  it('formats timestamps after India midnight consistently in every view', () => {
    const value = '2026-09-05T19:00:00.000Z';
    expect(formatIndiaDate(value)).toBe('6 Sept 2026');
    expect(formatIndiaDate(value, true)).toBe('6 Sept 2026, 12:30 am');
    expect(formatIndiaDeadline(value)).toBe('6 Sept, 12:30 am');
  });

  it('preserves the date and deadline fallback wording', () => {
    expect(formatIndiaDate('invalid')).toBe('Date unavailable');
    expect(formatIndiaDate('', true)).toBe('Date unavailable');
    expect(formatIndiaDeadline('invalid')).toBe('Deadline unavailable');
  });
});
