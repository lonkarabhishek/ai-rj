import type { MetadataRoute } from "next";

/** Web app manifest: lets the radio be added to the home screen and opened full screen (no browser bars). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MyRJ — your AI radio",
    short_name: "MyRJ",
    description: "Your own AI radio host between your Spotify or YouTube songs.",
    id: "/live",
    start_url: "/live",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0908",
    theme_color: "#0a0908",
    categories: ["music", "entertainment"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
