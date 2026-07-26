import { chromium } from "playwright";
import fs from "fs/promises";
import config from "./config.js";

const browser = await chromium.launch({
  headless: true
});

const context = await browser.newContext();

const page = await context.newPage();

page.setDefaultTimeout(config.browser.timeout);

for (const category of config.categories) {
  console.log(`Category: ${category.name}`);

  await page.goto(category.url, {
    waitUntil: "networkidle"
  });

  await page.waitForTimeout(5000);

  const mhtml = await page.context().newCDPSession(page);

  const { data } = await mhtml.send("Page.captureSnapshot", {
    format: "mhtml"
  });

  await fs.mkdir("mhtml", {
    recursive: true
  });

  await fs.writeFile(
    `mhtml/${category.name}.mhtml`,
    data,
    "utf8"
  );
}

await browser.close();
