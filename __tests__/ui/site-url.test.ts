import { resolveSiteMetadataUrls } from '@/config/site-url';

describe('public metadata URL resolution', () => {
  test('uses the production NEXTAUTH_URL for absolute sharing URLs', () => {
    const urls = resolveSiteMetadataUrls({
      NODE_ENV: 'production',
      NEXTAUTH_URL: 'https://quoteplate.example',
    });

    expect(urls.metadataBase.toString()).toBe('https://quoteplate.example/');
    expect(urls.socialImageUrl).toBe('https://quoteplate.example/brand/social-card.png');
    expect(JSON.stringify(urls)).not.toContain('localhost');
  });

  test('uses the Netlify production URL when NEXTAUTH_URL is not available', () => {
    const urls = resolveSiteMetadataUrls({
      NODE_ENV: 'production',
      URL: 'https://quoteplate.netlify.app',
    });

    expect(urls.metadataBase.toString()).toBe('https://quoteplate.netlify.app/');
    expect(urls.socialImageUrl).toBe('https://quoteplate.netlify.app/brand/social-card.png');
  });
});
