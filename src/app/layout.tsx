import type { Metadata } from "next";
import "@fontsource-variable/manrope";
import "@fontsource-variable/newsreader";
import "./globals.css";
import { brand } from "@/config/brand";
import { resolveSiteMetadataUrls } from "@/config/site-url";

const siteUrls = resolveSiteMetadataUrls();

export const metadata: Metadata = {
  metadataBase: siteUrls.metadataBase,
  title: {
    default: `${brand.productName} — ${brand.tagline}`,
    template: `%s — ${brand.productName}`,
  },
  description: brand.description,
  applicationName: brand.productName,
  icons: {
    icon: "/icon.svg",
  },
  openGraph: {
    type: "website",
    locale: "en_IN",
    siteName: brand.productName,
    title: `${brand.productName} — ${brand.tagline}`,
    description: brand.description,
    images: [
      {
        url: siteUrls.socialImageUrl,
        width: 1200,
        height: 630,
        alt: `${brand.productName} — ${brand.tagline}`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${brand.productName} — ${brand.tagline}`,
    description: brand.description,
    images: [siteUrls.socialImageUrl],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  );
}
