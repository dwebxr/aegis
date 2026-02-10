import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const WIDTH = 1200;
const HEIGHT = 630;

// Theme colors from styles/theme.ts
const BG = "#0a0f1e";
const SURFACE = "#0f1729";
const BLUE = "#3b82f6";
const CYAN = "#06b6d4";
const TEXT_PRIMARY = "#f1f5f9";
const TEXT_SECONDARY = "#94a3b8";
const TEXT_MUTED = "#64748b";
const BADGE_BG = "#131c33";

const svg = `
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${BG}"/>
      <stop offset="100%" stop-color="${SURFACE}"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${BLUE}"/>
      <stop offset="100%" stop-color="${CYAN}"/>
    </linearGradient>
    <linearGradient id="glowGrad" x1="0.5" y1="0" x2="0.5" y2="1">
      <stop offset="0%" stop-color="${BLUE}" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="${CYAN}" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bgGrad)"/>

  <!-- Subtle glow at top -->
  <ellipse cx="600" cy="0" rx="600" ry="300" fill="url(#glowGrad)"/>

  <!-- Top accent line -->
  <rect x="0" y="0" width="${WIDTH}" height="4" fill="url(#accent)"/>

  <!-- Grid dots pattern (decorative) -->
  ${Array.from({ length: 12 }, (_, i) =>
    Array.from({ length: 6 }, (_, j) =>
      `<circle cx="${100 + i * 100}" cy="${100 + j * 100}" r="1" fill="${TEXT_MUTED}" opacity="0.15"/>`
    ).join("")
  ).join("")}

  <!-- Title -->
  <text x="120" y="240" font-family="system-ui, -apple-system, sans-serif" font-size="72" font-weight="800" fill="${TEXT_PRIMARY}" letter-spacing="-1">
    Aegis
  </text>

  <!-- Subtitle -->
  <text x="120" y="300" font-family="system-ui, -apple-system, sans-serif" font-size="32" font-weight="400" fill="${TEXT_SECONDARY}">
    AI Content Quality Filter
  </text>

  <!-- Description -->
  <text x="120" y="370" font-family="system-ui, -apple-system, sans-serif" font-size="22" fill="${TEXT_MUTED}">
    Zero-noise briefing powered by AI + Nostr + Internet Computer
  </text>

  <!-- Badge: AI Scoring -->
  <rect x="120" y="420" width="140" height="38" rx="8" fill="${BADGE_BG}" stroke="${BLUE}" stroke-opacity="0.3" stroke-width="1"/>
  <text x="190" y="445" font-family="system-ui, sans-serif" font-size="16" font-weight="600" fill="${BLUE}" text-anchor="middle">AI Scoring</text>

  <!-- Badge: Nostr -->
  <rect x="276" y="420" width="100" height="38" rx="8" fill="${BADGE_BG}" stroke="${CYAN}" stroke-opacity="0.3" stroke-width="1"/>
  <text x="326" y="445" font-family="system-ui, sans-serif" font-size="16" font-weight="600" fill="${CYAN}" text-anchor="middle">Nostr</text>

  <!-- Badge: ICP -->
  <rect x="392" y="420" width="80" height="38" rx="8" fill="${BADGE_BG}" stroke="${BLUE}" stroke-opacity="0.3" stroke-width="1"/>
  <text x="432" y="445" font-family="system-ui, sans-serif" font-size="16" font-weight="600" fill="${BLUE}" text-anchor="middle">ICP</text>

  <!-- Badge: D2A -->
  <rect x="488" y="420" width="80" height="38" rx="8" fill="${BADGE_BG}" stroke="${CYAN}" stroke-opacity="0.3" stroke-width="1"/>
  <text x="528" y="445" font-family="system-ui, sans-serif" font-size="16" font-weight="600" fill="${CYAN}" text-anchor="middle">D2A</text>

  <!-- URL -->
  <text x="120" y="560" font-family="system-ui, sans-serif" font-size="18" fill="${TEXT_MUTED}">
    aegis.dwebxr.xyz
  </text>

  <!-- Bottom accent line -->
  <rect x="0" y="${HEIGHT - 3}" width="${WIDTH}" height="3" fill="url(#accent)"/>
</svg>
`;

// Resize the aegis icon to overlay
const iconPath = path.join(root, "aegis.png");
const outputPath = path.join(root, "public", "og-image.png");

const icon = await sharp(iconPath).resize(160, 160).png().toBuffer();

const bgBuffer = Buffer.from(svg);

const result = await sharp(bgBuffer)
  .png()
  .composite([{ input: icon, top: 190, left: 900 }])
  .toFile(outputPath);

console.log(`OG image generated: ${outputPath}`);
console.log(`Size: ${result.size} bytes (${(result.size / 1024).toFixed(1)} KB)`);
console.log(`Dimensions: ${result.width}x${result.height}`);
