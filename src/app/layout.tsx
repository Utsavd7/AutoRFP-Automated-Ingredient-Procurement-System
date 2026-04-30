import type { Metadata } from "next";
import { ToastViewport } from "@/components/ToastViewport";
import "./globals.css";

export const metadata: Metadata = {
  title: "AutoRFP — Intelligent Procurement Platform",
  description: "AI-powered restaurant ingredient procurement: menu parsing, live pricing, supplier discovery, and autonomous negotiation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark bg-black">
      <body
        className="antialiased bg-black text-[#F2F2F2] selection:bg-[#5E6AD2]/30 selection:text-white"
      >
        {children}
        <ToastViewport />
      </body>
    </html>
  );
}
