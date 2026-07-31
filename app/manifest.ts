import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BlockTrade 기관 통제 앱",
    short_name: "BlockTrade",
    description: "기관용 가상자산 운용의 승인·모니터링·위험 통제를 위한 BlockTrade 모의 운용 동반 앱",
    start_url: "/mobile",
    scope: "/",
    display: "standalone",
    background_color: "#f4f7fb",
    theme_color: "#0b1220",
    orientation: "any",
    lang: "ko",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/blocktrade-app-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/blocktrade-app-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
