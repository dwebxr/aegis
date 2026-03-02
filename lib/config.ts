/** Canonical application URL — reads from NEXT_PUBLIC_APP_URL with production fallback. */
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://aegis.dwebxr.xyz").replace(/\/$/, "");
