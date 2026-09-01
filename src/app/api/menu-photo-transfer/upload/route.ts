import { createPhotoTransferRouteHandlers } from '@/lib/menu/photo-transfer-http';
import { createNetlifyPhotoTransferStore } from '@/lib/menu/photo-transfer-store';
import { requireAccountContext } from '@/lib/server-account';

const handlers = createPhotoTransferRouteHandlers({
  accountContext: requireAccountContext,
  storeFactory: () => createNetlifyPhotoTransferStore(),
  getSecret: () => process.env.NEXTAUTH_SECRET,
  now: () => Date.now(),
});

export const PUT = handlers.uploadPUT;
export const POST = handlers.uploadPOST;
