import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Signal Trail",
  description: "Record real-world mobile connection quality, one reading at a time.",
  manifest: "/manifest.webmanifest",
  applicationName: "Signal Trail",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Signal Trail",
  },
  icons: {
    icon: "/favicon.svg",
    apple: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#10110f",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
