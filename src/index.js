import TelegramBot from "node-telegram-bot-api";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import config from "../config.js";

const bot = new TelegramBot(
  process.env.TELEGRAM_BOT_TOKEN,
  { polling: false }
);

console.log("Instagram Reels Distributor Started");

const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage"
  ]
});

for (const category of config.categories) {

  console.log(`Opening: ${category.name}`);

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
    await session.send(
      "Page.captureSnapshot",
      {
        format: "mhtml"
      }
    );

  const $ = cheerio.load(data);

  const reels = new Set();

  $("a").each((_, element) => {

    let href =
      $(element).attr("href");

    if (!href) return;

    if (
      href.includes("/reel/") ||
      href.includes("/reels/videos/")
    ) {

      if (
        href.startsWith("/")
      ) {
        href =
          "https://instagram.com" +
          href;
      }

      const match =
        href.match(
          /\/(?:reel|reels\/videos)\/([A-Za-z0-9_-]+)/
        );

      if (!match) return;

      reels.add(
        `https://instagram.com/reels/videos/${match[1]}?l`
      );

    }

  });

  console.log(
    `${category.name}: ${reels.size} reels`
  );

  let count = 0;

  for (const reel of reels) {

    if (
      count >= category.limit
    ) {
      break;
    }

    await bot.sendMessage(
      process.env.TELEGRAM_CHANNEL_ID,
      reel,
      {
        disable_web_page_preview: true
      }
    );

    count++;

    await new Promise(resolve =>
      setTimeout(resolve, 20000)
    );

  }

  console.log(
    `${count} links sent`
  );

  await page.close();

}

await browser.close();

console.log("Finished");
