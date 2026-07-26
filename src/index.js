import * as cheerio from "cheerio";
import { chromium } from "playwright";
import config from "../config.js";

console.log("Instagram Reels Distributor Started");

async function getDownloadUrl(browser, saveFromUrl) {

  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
  });

  try {

    console.log("Opening SaveFrom");

    await page.goto(saveFromUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
    await page.screenshot({
  path: "savefrom.png",
  fullPage: true,
});

console.log(await page.title());

console.log(await page.content());
    
    const button = await page.waitForSelector(
      "a[href*='media.sf-converter.com']",
      {
        state: "visible",
        timeout: 30000
      }
    );

    const downloadUrl =
      await button.getAttribute("href");

    return downloadUrl;

  } catch (error) {

    console.log("Download url not found");

    return null;

  } finally {

    await page.close();

  }

}

const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage"
  ]
});

for (const category of config.categories) {

  console.log(`\nOpening: ${category.name}`);

  const page = await browser.newPage({

    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",

    viewport: {
      width: 1366,
      height: 768
    }

  });

  await page.goto(category.url, {
    waitUntil: "networkidle",
    timeout: config.browser.timeout
  });

  const session =
    await page.context().newCDPSession(page);

  const { data } =
    await session.send("Page.captureSnapshot", {
      format: "mhtml"
    });

  const $ = cheerio.load(data);

  const reels = [];

  $("a").each((_, element) => {

    const href = $(element).attr("href");

    if (!href) return;

    const match = href.match(
      /\/(?:reel|reels\/videos)\/([A-Za-z0-9_-]+)/
    );

    if (!match) return;

    const reelUrl =
      `https://www.instagram.com/reel/${match[1]}/`;

    if (!reels.includes(reelUrl)) {
      reels.push(reelUrl);
    }

  });

  console.log(`Found ${reels.length} reels`);

  for (const reel of reels.slice(0, category.limit)) {

    const saveFromUrl =
      `https://en1.savefrom.net/19wr/#url=${encodeURIComponent(
        reel + "?noredirect=1"
      )}&`;

    const downloadUrl =
  await getDownloadUrl(
    browser,
    saveFromUrl
  );

if (!downloadUrl) {

  continue;

}

console.log(downloadUrl);

  }

  await page.close();

}

await browser.close();

console.log("\nFinished");
