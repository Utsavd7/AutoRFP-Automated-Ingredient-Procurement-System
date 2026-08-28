import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AutoRFP — Restaurant Procurement",
  description: "Create reviewable menu drafts and prepare for the launch supplier quote and award workflow.",
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
      </body>
    </html>
  );
}
