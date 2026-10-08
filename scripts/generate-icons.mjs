import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const browser = await chromium.launch();
const svg = readFileSync("apps/web/public/icon.svg", "utf8");
for (const size of [192, 512]) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<style>*{margin:0}svg{display:block;width:100vw;height:100vh}</style>${svg}`,
  );
  await page.screenshot({
    path: `apps/web/public/icon-${size}.png`,
    omitBackground: true,
  });
  await page.close();
}
await browser.close();
