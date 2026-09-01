import { createPhotoTransferRouteHandlers } from '@/lib/menu/photo-transfer-http';
import { consumePhotoTransferRateLimit } from '@/lib/menu/photo-transfer-rate-limit';
import { createNetlifyPhotoTransferStore } from '@/lib/menu/photo-transfer-store';
import { requireAccountContext } from '@/lib/server-account';

const handlers = createPhotoTransferRouteHandlers({
  accountContext: requireAccountContext,
  storeFactory: () => createNetlifyPhotoTransferStore(),
  getSecret: () => process.env.NEXTAUTH_SECRET,
  now: () => Date.now(),
  rateLimit: consumePhotoTransferRateLimit,
});

export const POST = handlers.laptopPOST;
