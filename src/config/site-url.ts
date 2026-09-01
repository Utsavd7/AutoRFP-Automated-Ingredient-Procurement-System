const LOCAL_SITE_URL = "http://localhost:3000";
const SOCIAL_IMAGE_PATH = "/brand/social-card.png";

type SiteUrlEnvironment = {
  NODE_ENV?: string;
  NEXTAUTH_URL?: string;
  URL?: string;
  DEPLOY_PRIME_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  VERCEL_URL?: string;
};

function deploymentUrl(host: string) {
  return /^https?:\/\//i.test(host) ? host : `https://${host}`;
}

export function resolveSiteMetadataUrls(env: SiteUrlEnvironment = process.env) {
  const configuredUrl = env.NEXTAUTH_URL?.trim();
  const deploymentHost = (
    env.URL
    ?? env.DEPLOY_PRIME_URL
    ?? env.VERCEL_PROJECT_PRODUCTION_URL
    ?? env.VERCEL_URL
  )?.trim();
  const metadataBase = new URL(
    configuredUrl
      ?? (deploymentHost ? deploymentUrl(deploymentHost) : LOCAL_SITE_URL),
  );

  return {
    metadataBase,
    socialImageUrl: new URL(SOCIAL_IMAGE_PATH, metadataBase).toString(),
  };
}
