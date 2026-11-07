# shutdown-site

Aegis ended on 2026-11-08. This directory is the static site that replaced the app in the Vercel project `aegis`. It has no build step, no functions, and no environment variables.

- Every URL returns **410 Gone** with `public/index.html`. That includes `/`, `/api/*`, `/robots.txt`, `/openapi.json`, `/llms.txt`, and `/manifest.json`.
- `/sw.js` returns 200 with a kill-switch service worker. Browsers that still have the old Serwist PWA worker check `/sw.js` on navigation. The new worker installs, deletes every Cache Storage entry, unregisters itself, and reloads the windows it controlled. It was tested locally against the real old worker: a tab left open on the old app also moved to the end page. Do not add page-side `unregister()` code. It removes the registration before the update check runs, so the kill switch never installs and open tabs keep the old app.
- The kill switch reaches `https://aegis-ai.xyz`, `https://aegis.dwebxr.xyz`, and `https://aegis-kappa-eight.vercel.app`; all three serve the site directly. `www.aegis-ai.xyz` answers 307 to the apex, and a service worker update does not follow redirects, so a browser that registered the old worker on www keeps it. It still shows the end page online, because the old worker fetches pages from the network first.

`vercel.json` uses legacy `routes`, because only routes can set a status on every path. `framework: null` overrides the project's Next.js preset, and `outputDirectory: public` keeps this README and `vercel.json` out of the served files.

## Deploy

Run from the repository root:

```bash
mkdir -p shutdown-site/.vercel && cp .vercel/project.json shutdown-site/.vercel/   # gitignored; targets project "aegis"
cd shutdown-site
npx -y vercel@latest deploy --yes            # preview first
npx -y vercel@latest deploy --prod --yes     # production
```

Check the build log for the preview: there must be no install or build command. Then check:

- `/`, `/api/health`, `/api/d2a/score`, `/robots.txt`, `/openapi.json`, and an unknown path return 410 with the end page, `Cache-Control: no-store`, `X-Robots-Tag: noindex`, and the CSP. A POST to `/api/d2a/score` also returns exactly 410 with the end page. The old app answered 405 there, so a 405 means the old app is still serving.
- `/sw.js` returns 200 JavaScript. Vercel route matching ignores case, so `/SW.JS` serves the same file. That is harmless: nothing registers that URL, and a browser that did would get the same kill switch. Through Cloudflare its `Cache-Control` may show `max-age=14400`, because of the zone's Browser Cache TTL. That is harmless: service worker update checks bypass the browser cache.
- aegis.dwebxr.xyz and aegis-kappa-eight.vercel.app serve the same responses directly; www returns 307 to `https://aegis-ai.xyz/`.

After the production deploy, run **Purge Everything** in Cloudflare for the `aegis-ai.xyz` zone. Do not use the open-pay.jp zone; the two are easy to confuse.

## No rollback

The app cannot come back. The IC canister was deleted on 2026-11-08, every environment variable was removed from the Vercel project, and every older deployment was deleted. The end page is the only deployment left. Do not deploy from the repository root: without the canister and the keys, the app would come up broken.

## End of the domain

`aegis-ai.xyz` will not be renewed. The registration ends on 2027-03-28. After that date, the end page stays up at `https://aegis.dwebxr.xyz` (the `dwebxr.xyz` domain is kept). Before 2027-03-28, do these steps in this order:

1. Done on 2026-11-08: `aegis.dwebxr.xyz` and `aegis-kappa-eight.vercel.app` were switched from "Redirect to aegis-ai.xyz" (307) to serving the production deployment directly. This had to come first: a redirect left pointing at an expired domain sends visitors to whoever registers it next.
2. Remove `aegis-ai.xyz` and `www.aegis-ai.xyz` from the project.
3. Delete the `aegis-ai.xyz` zone from Cloudflare. Do not touch the `open-pay.jp` zone.
4. Change the GitHub repository's website URL and the links in `README.md` to `https://aegis.dwebxr.xyz`.

After 2027-03-28 someone else may register `aegis-ai.xyz`. Treat anything served there as unrelated to this project. If the end page is ever retired completely, delete the Vercel project and the `aegis` record in the `dwebxr.xyz` zone together, so no DNS record keeps pointing at Vercel.
