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
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
    >
      {!decorative && <title>{title}</title>}
      <path
        className="brand-mark__request"
        d="M3 4h13v10h-4v6H8v8L3 25V4Z"
        fill="currentColor"
      />
      <path
        className="brand-mark__quote"
        d="M17 8 29 13v15H14v-9h4v-6h-1V8Z"
        fill="currentColor"
      />
    </svg>
  );
}
