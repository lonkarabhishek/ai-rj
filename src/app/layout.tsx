import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AccountSync } from "@/components/account";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MyRJ — Your AI Radio Jockey for Spotify & YouTube",
  description: "Your own AI radio jockey. Speaks your language, plays your music from Spotify or YouTube, shares your news.",
  openGraph: { title: "MyRJ — Your AI Radio Jockey for Spotify & YouTube", description: "An AI RJ talks between your songs with jokes, news and song facts. Plays from Spotify or YouTube. Open source, self-hosted.", type: "website", siteName: "MyRJ" },
  twitter: { card: "summary", title: "MyRJ — Your AI Radio Jockey", description: "An AI RJ between your Spotify or YouTube songs. Open source." },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0a0908" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col overflow-x-hidden"><AccountSync />{children}</body>
    </html>
  );
}
