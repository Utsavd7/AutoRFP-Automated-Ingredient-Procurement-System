import { notFound } from 'next/navigation';
import DemoSeedClient from './DemoSeedClient';
import { isLegacyFeatureEnabled } from '@/lib/features/legacy-features';

export default function DemoSeedPage() {
  if (!isLegacyFeatureEnabled()) {
    notFound();
  }

  return <DemoSeedClient />;
}
