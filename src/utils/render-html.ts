/**
 * Render a red-flag analysis HTML card to a PNG image buffer.
 * Uses Puppeteer (with Trigger.dev's puppeteer build extension for cloud deployment).
 *
 * Returns a Buffer containing the PNG data (suitable for uploading or saving).
 */

import puppeteer from "puppeteer";

const CSS_VARIABLES = `
:root {
    --font-sans: "Segoe UI", system-ui, -apple-system, sans-serif;
    --color-text-primary: #1a1a1a;
    --color-text-secondary: #555555;
    --color-text-tertiary: #888888;
    --color-border-tertiary: #e0e0e0;
    --border-radius-md: 6px;
    --border-radius-lg: 12px;
    --color-background-secondary: #f5f5f5;
    --color-background-success: #e8f5e9;
    --color-border-success: #c8e6c9;
    --color-text-success: #2e7d32;
    --color-background-danger: #ffebee;
    --color-border-danger: #ffcdd2;
    --color-text-danger: #c62828;
}
`;

function buildFullHtml(cardHtml: string): string {
  return `<!DOCTYPE html>
<html lang="da">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=1200">
    <style>
        ${CSS_VARIABLES}
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            background: #ffffff;
            padding: 60px 32px;
            font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
        }
    </style>
</head>
<body>
    ${cardHtml}
</body>
</html>`;
}

export async function renderHtmlToImage(cardHtml: string): Promise<Buffer> {
  const fullHtml = buildFullHtml(cardHtml);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 2 });
    await page.setContent(fullHtml, { waitUntil: "networkidle0" });
    const buffer = await page.screenshot({ fullPage: true });
    return Buffer.from(buffer);
  } finally {
    await browser.close();
  }
}
