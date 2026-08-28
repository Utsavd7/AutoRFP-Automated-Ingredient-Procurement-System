import { brand } from '@/config/brand';
import { BrandMark } from './BrandMark';

type WordmarkProps = {
  className?: string;
  inverse?: boolean;
  markTone?: 'ink' | 'stone' | 'copper' | 'duotone';
};

export function Wordmark({ className = '', inverse = false, markTone }: WordmarkProps) {
  return (
    <span className={`wordmark ${inverse ? 'wordmark--inverse' : ''} ${className}`.trim()}>
      <BrandMark decorative tone={markTone ?? (inverse ? 'stone' : 'duotone')} />
      <span className="wordmark__name">{brand.productName}</span>
    </span>
  );
}
