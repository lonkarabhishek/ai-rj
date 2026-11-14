import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { AccountSync } from "@/components/account";

export const metadata: Metadata = {
  title: "MyRJ — Your AI Radio Jockey for Spotify & YouTube",
  description: "Your own AI radio jockey. Speaks your language, plays your music from Spotify or YouTube, shares your news.",
  openGraph: { title: "MyRJ — Your AI Radio Jockey for Spotify & YouTube", description: "An AI RJ talks between your songs with jokes, news and song facts. Plays from Spotify or YouTube. Open source, self-hosted.", type: "website", siteName: "MyRJ" },
  twitter: { card: "summary", title: "MyRJ — Your AI Radio Jockey", description: "An AI RJ between your Spotify or YouTube songs. Open source." },
  applicationName: "MyRJ",
  appleWebApp: { capable: true, title: "MyRJ", statusBarStyle: "black-translucent" },
  icons: { icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }, { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }], apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }] },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#050b1c" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col overflow-x-hidden"><AccountSync />{children}</body>
    </html>
  );
}
