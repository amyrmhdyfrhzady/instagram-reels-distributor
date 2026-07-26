import fs from "fs/promises";
import path from "path";

import { chromium } from "playwright";

export async function downloadReel(reel) {

  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    acceptDownloads: true
  });

  const page = await context.newPage();

  await page.goto("https://blastup.com/instagram-downloader", {
    waitUntil: "domcontentloaded"
  });

  await page.fill("#link", reel);

  const downloadPromise = page.waitForEvent("download");

  await page.click("button[type='submit']");

  const download = await downloadPromise;

  await fs.mkdir("downloads", {
    recursive: true
  });

  const file = path.join(
    "downloads",
    await download.suggestedFilename()
  );

  await download.saveAs(file);

  await browser.close();

  return file;

}
