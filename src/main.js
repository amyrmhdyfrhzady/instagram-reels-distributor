import config from "./config.js";
import getReels from "./instagram.js";
import downloadFromBlastUp from "./blastup.js";
import sendFile from "./bale.js";

import { chromium } from "playwright";

export default async function run(users, sent) {

  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    acceptDownloads: true
  });

  const page = await context.newPage();

  for (const category of config.categories) {

    const reels = await getReels(page, category);

    for (const reel of reels) {

      if (sent.has(reel))
        continue;

      try {

        const file = await downloadFromBlastUp(page, reel);

        for (const user of users) {

          try {

            await sendFile(user, file);

          } catch {

            continue;

          }

        }

        sent.add(reel);

      } catch {

        continue;

      }

    }

  }

  await browser.close();

}
