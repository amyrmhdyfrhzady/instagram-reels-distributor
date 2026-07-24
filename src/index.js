import TelegramBot from "node-telegram-bot-api";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import fs from "fs-extra";
import path from "path";
import config from "../config.js";
const bot =
  new TelegramBot(
    process.env.TELEGRAM_BOT_TOKEN,
    {
      polling: false
    }
  );

console.log("Instagram Reels Distributor Started");

const outputDir = "temp";

await fs.ensureDir(outputDir);

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

  const filePath = path.join(
    outputDir,
    `${category.name}.mhtml`
  );

  const session =
    await page.context().newCDPSession(page);

  const snapshot =
    await session.send(
      "Page.captureSnapshot",
      {
        format: "mhtml"
      }
    );

  await fs.writeFile(
    filePath,
    snapshot.data
  );
  const html =
  await fs.readFile(
    filePath,
    "utf8"
  );

const $ =
  cheerio.load(html);

const reels =
  new Set();

$("a").each((_, element) => {

  const href =
    $(element).attr("href");

  if (!href) {
    return;
  }

  if (
    href.includes("/reel/") ||
    href.includes("/reels/videos/")
  ) {

    let url = href;

    if (
      url.startsWith("/")
    ) {

      url =
        "https://instagram.com" +
        url;

    }

    url =
      url
        .replace(
          "www.instagram.com",
          "instagram.com"
        )
        .replace(
          /\?.*/,
          "?l"
        );

    reels.add(url);

  }

});

console.log(
  `${category.name}: ${reels.size} reels found`
);

console.log(
  [...reels]
);
  for (const reel of reels) {

  await bot.sendMessage(
    process.env.TELEGRAM_CHAT_ID,
    reel,
    {
      disable_web_page_preview: true
    }
  );

  await new Promise(resolve =>
    setTimeout(resolve, 1000)
  );

}

console.log(
  `${reels.size} links sent`
);
  console.log(
    `Saved: ${filePath}`
  );

  await page.close();

}

await browser.close();

console.log("Finished");
