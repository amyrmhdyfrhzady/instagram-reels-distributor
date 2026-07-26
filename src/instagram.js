import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright";

import config from "./config.js";

export async function getReelsFromCategory(category) {

  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext();

  const page = await context.newPage();

  page.setDefaultTimeout(config.browser.timeout);

  await page.goto(category.url, {
    waitUntil: "networkidle"
  });

  await page.waitForTimeout(5000);

  const client = await context.newCDPSession(page);

  const { data } = await client.send("Page.captureSnapshot", {
    format: "mhtml"
  });

  await fs.mkdir("mhtml", {
    recursive: true
  });

  const file = path.join("mhtml", `${category.name}.mhtml`);

  await fs.writeFile(file, data);

  const html = await fs.readFile(file, "utf8");

  const reels = [];

  const regex =
    /https:\/\/www\.instagram\.com\/reel\/([A-Za-z0-9_-]+)\//g;

  let match;

  while ((match = regex.exec(html)) !== null) {

    const reel = `https://www.instagram.com/reel/${match[1]}/`;

    if (!reels.includes(reel))
      reels.push(reel);

    if (reels.length >= category.limit)
      break;

  }

  await browser.close();

  return reels;

  }
