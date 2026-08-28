import { brand } from '@/config/brand';

type BrandMarkProps = {
  className?: string;
  decorative?: boolean;
  title?: string;
  tone?: 'ink' | 'stone' | 'copper' | 'duotone';
};

const toneClass = {
  ink: 'brand-mark--ink',
  stone: 'brand-mark--stone',
  copper: 'brand-mark--copper',
  duotone: 'brand-mark--duotone',
} as const;

export function BrandMark({
  className = '',
  decorative = false,
  title = `${brand.productName} request-to-quote ledger mark`,
  tone = 'ink',
}: BrandMarkProps) {
  return (
    <svg
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : title}
      className={`brand-mark ${toneClass[tone]} ${className}`.trim()}
      role={decorative ? undefined : 'img'}
      viewBox="0 0 34 40"
      xmlns="http://www.w3.org/2000/svg"
    >
      {!decorative && <title>{title}</title>}
      <path
        className="brand-mark__request"
        d="M3 3h14v17h-5v10L3 26V3Z"
        fill="currentColor"
      />
      <path
        className="brand-mark__quote"
        d="M20 9 30 13v22H16V23h4V9Z"
        fill="currentColor"
      />
    </svg>
  );
}
