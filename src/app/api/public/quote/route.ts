import { createPublicQuoteHandlers } from '@/lib/quotes/public-quote-http';

const handlers = createPublicQuoteHandlers();

export const GET = handlers.GET;
export const POST = handlers.POST;
