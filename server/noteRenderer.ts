import fs from 'node:fs';
import path from 'node:path';

export interface StructuredPage {
  heading: string;
  subheading?: string;
  bullets: string[];
  formula?: string;
  tip?: string;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length <= maxChars) {
      current = (current + ' ' + word).trim();
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Generates a heavily blurred, redacted low-res SVG preview of Page 1.
 * Never leaks readable note content before purchase.
 */
export function renderBlurredPreviewSvg(title: string, subject: string, pageCount: number): string {
  const safeTitle = escapeXml(title.slice(0, 44));
  const safeSubject = escapeXml(subject.slice(0, 28));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800" width="600" height="800">
  <defs>
    <filter id="heavyBlur" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur stdDeviation="9" />
    </filter>
    <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#e2e8f0" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="600" height="800" fill="#ffffff"/>
  <rect width="600" height="800" fill="url(#grid)" opacity="0.55"/>
  <g filter="url(#heavyBlur)">
    <rect x="44" y="48" width="240" height="22" rx="4" fill="#4f46e5" opacity="0.45"/>
    <rect x="44" y="84" width="420" height="14" rx="4" fill="#1e293b" opacity="0.5"/>
    <rect x="44" y="130" width="510" height="10" rx="3" fill="#64748b" opacity="0.35"/>
    <rect x="44" y="152" width="470" height="10" rx="3" fill="#64748b" opacity="0.35"/>
    <rect x="44" y="174" width="490" height="10" rx="3" fill="#64748b" opacity="0.35"/>
    <rect x="44" y="216" width="512" height="110" rx="8" fill="#eef2ff" stroke="#818cf8" stroke-width="2" opacity="0.7"/>
    <rect x="64" y="246" width="320" height="14" rx="3" fill="#312e81" opacity="0.5"/>
    <rect x="64" y="274" width="260" height="12" rx="3" fill="#4338ca" opacity="0.4"/>
    <rect x="44" y="360" width="495" height="10" rx="3" fill="#475569" opacity="0.38"/>
    <rect x="44" y="384" width="440" height="10" rx="3" fill="#475569" opacity="0.38"/>
    <rect x="44" y="408" width="505" height="10" rx="3" fill="#475569" opacity="0.38"/>
    <rect x="44" y="432" width="380" height="10" rx="3" fill="#475569" opacity="0.38"/>
    <circle cx="170" cy="560" r="76" fill="none" stroke="#4f46e5" stroke-width="5" opacity="0.4"/>
    <line x1="170" y1="560" x2="225" y2="510" stroke="#0f172a" stroke-width="4" opacity="0.4"/>
    <rect x="290" y="505" width="250" height="12" rx="3" fill="#334155" opacity="0.4"/>
    <rect x="290" y="530" width="210" height="12" rx="3" fill="#334155" opacity="0.35"/>
    <rect x="290" y="555" width="230" height="12" rx="3" fill="#334155" opacity="0.35"/>
    <rect x="44" y="690" width="512" height="58" rx="6" fill="#ecfdf5" opacity="0.75"/>
  </g>
  <rect x="0" y="0" width="600" height="800" fill="rgba(15, 23, 42, 0.08)"/>
  <g transform="translate(300, 390)" text-anchor="middle">
    <rect x="-190" y="-64" width="380" height="128" rx="16" fill="#0f172a" fill-opacity="0.86"/>
    <text x="0" y="-22" fill="#e2e8f0" font-family="sans-serif" font-size="13" font-weight="600">${safeSubject} · ${pageCount} Pages</text>
    <text x="0" y="6" fill="#ffffff" font-family="sans-serif" font-size="16" font-weight="700">${safeTitle}</text>
    <text x="0" y="34" fill="#a5b4fc" font-family="sans-serif" font-size="13" font-weight="600">Preview Locked · Unlock to Read Full Notes</text>
  </g>
</svg>`;
}

/**
 * Renders an unlocked crisp study note page SVG with server-embedded buyer watermark.
 */
export function renderStructuredPageSvg(
  noteTitle: string,
  subject: string,
  pageNumber: number,
  totalPages: number,
  page: StructuredPage,
  watermarkText: string,
): string {
  const safeTitle = escapeXml(noteTitle);
  const safeSubject = escapeXml(subject);
  const safeHeading = escapeXml(page.heading);
  const safeSubheading = page.subheading ? escapeXml(page.subheading) : '';
  const safeWatermark = escapeXml(watermarkText);

  let y = 138;
  const bulletElements: string[] = [];

  for (const bullet of page.bullets) {
    const lines = wrapText(bullet, 62);
    lines.forEach((line, idx) => {
      const prefix = idx === 0 ? '•  ' : '   ';
      bulletElements.push(
        `<text x="56" y="${y}" fill="#1e293b" font-family="sans-serif" font-size="16">${escapeXml(prefix + line)}</text>`,
      );
      y += 26;
    });
    y += 10;
  }

  let formulaBlock = '';
  if (page.formula) {
    const formulaY = Math.max(y + 10, 470);
    formulaBlock = `
      <rect x="52" y="${formulaY}" width="596" height="84" rx="10" fill="#eef2ff" stroke="#c7d2fe" stroke-width="1.5"/>
      <text x="72" y="${formulaY + 28}" fill="#4338ca" font-family="sans-serif" font-size="12" font-weight="700">KEY FORMULA / RULE</text>
      <text x="72" y="${formulaY + 58}" fill="#1e1b4b" font-family="monospace" font-size="17" font-weight="700">${escapeXml(page.formula)}</text>
    `;
    y = formulaY + 108;
  }

  let tipBlock = '';
  if (page.tip) {
    const tipY = Math.max(y + 8, 585);
    const tipLines = wrapText(page.tip, 64);
    tipBlock = `
      <rect x="52" y="${tipY}" width="596" height="${46 + tipLines.length * 22}" rx="10" fill="#ecfdf5" stroke="#a7f3d0" stroke-width="1.5"/>
      <text x="72" y="${tipY + 26}" fill="#047857" font-family="sans-serif" font-size="12" font-weight="700">EXAM TIP</text>
      ${tipLines
        .map(
          (l, i) =>
            `<text x="72" y="${tipY + 50 + i * 22}" fill="#064e3b" font-family="sans-serif" font-size="14">${escapeXml(l)}</text>`,
        )
        .join('\n')}
    `;
  }

  // Diagonal repeating watermark baked directly into the server-rendered SVG
  const watermarks = [160, 420, 680]
    .map(
      (wy) =>
        `<text x="350" y="${wy}" text-anchor="middle" transform="rotate(-24 350 ${wy})" fill="#4f46e5" fill-opacity="0.09" font-family="monospace" font-size="15" font-weight="700">${safeWatermark}</text>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 920" width="700" height="920">
  <defs>
    <pattern id="noteGrid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#f1f5f9" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="700" height="920" fill="#ffffff"/>
  <rect width="700" height="920" fill="url(#noteGrid)"/>
  <rect x="0" y="0" width="700" height="6" fill="#4f46e5"/>
  <text x="52" y="44" fill="#64748b" font-family="sans-serif" font-size="12" font-weight="600">${safeSubject}  ·  ${safeTitle}</text>
  <text x="648" y="44" text-anchor="end" fill="#64748b" font-family="monospace" font-size="12">Page ${pageNumber} / ${totalPages}</text>
  <line x1="52" y1="58" x2="648" y2="58" stroke="#e2e8f0" stroke-width="1"/>
  <text x="52" y="96" fill="#0f172a" font-family="sans-serif" font-size="24" font-weight="700">${safeHeading}</text>
  ${safeSubheading ? `<text x="52" y="118" fill="#4f46e5" font-family="sans-serif" font-size="13" font-weight="600">${safeSubheading}</text>` : ''}
  ${bulletElements.join('\n')}
  ${formulaBlock}
  ${tipBlock}
  ${watermarks}
  <line x1="52" y1="875" x2="648" y2="875" stroke="#e2e8f0" stroke-width="1"/>
  <text x="52" y="898" fill="#94a3b8" font-family="monospace" font-size="10">Licensed to: ${safeWatermark}</text>
</svg>`;
}

export function ensurePrivateStorageDir(): string {
  const dir = path.resolve(process.cwd(), 'storage', 'private_notes');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveSafePrivatePath(relativeFilePath: string): string {
  const baseDir = ensurePrivateStorageDir();
  const resolved = path.resolve(baseDir, relativeFilePath);
  if (!resolved.startsWith(baseDir + path.sep)) {
    throw new Error('Invalid storage path');
  }
  return resolved;
}
