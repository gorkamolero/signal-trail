import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://signal-trail.hey548648.chatgpt.site"),
  title: "Signal Trail",
  description: "Test whether your mobile connection can hold a video call while you move.",
  manifest: "/manifest.webmanifest",
  applicationName: "Signal Trail",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Signal Trail",
  },
  icons: {
    icon: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "Signal Trail",
    description: "Measure the connection you actually have.",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Signal Trail" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Signal Trail",
    description: "Measure the connection you actually have.",
    images: ["/og.png"],
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
