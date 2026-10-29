import type { MetadataRoute } from "next";

// מאפשר להתקין את האתר על המסך הראשי של הטלפון ולפתוח אותו כאפליקציה במסך מלא.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MBH · אקורדים ממותגים",
    short_name: "MBH אקורדים",
    description: "הופכים שיר לתמונות אקורדים ממותגות, מוכנות לפרסום.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0d1c",
    theme_color: "#0b0d1c",
    lang: "he",
    dir: "rtl",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
