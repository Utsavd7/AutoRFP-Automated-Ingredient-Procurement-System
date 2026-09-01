import type { Metadata } from 'next';

import { MenuCaptureClient } from './MenuCaptureClient';

export const metadata: Metadata = {
  title: 'Send menu photos · QuotePlate',
  description: 'Send menu photos securely to the QuotePlate workspace that made this code.',
  robots: { index: false, follow: false },
};

export default function MenuCapturePage() {
  return <MenuCaptureClient />;
}
