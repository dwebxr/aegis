export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://aegis.dwebxr.xyz").replace(/\/$/, "");

export const SOCIAL_LINKS = [
  { key: "discord", href: "https://discord.gg/85JVzJaatT", title: "Discord" },
  { key: "medium", href: "https://medium.com/aegis-ai", title: "Medium" },
  { key: "x", href: "https://x.com/Coo_aiagent", title: "X" },
] as const;
