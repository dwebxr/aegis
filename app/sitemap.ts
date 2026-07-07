import type { MetadataRoute } from "next";
import { APP_URL } from "@/lib/config";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: APP_URL,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${APP_URL}/api-docs`,
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];
}
