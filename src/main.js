import fs from "fs";
import path from "path";

import config from "./config.js";

import { getReelsFromCategory } from "./instagram.js";
import { downloadReel } from "./blastup.js";
import { getUsers } from "./users.js";
import { sendFile } from "./bale.js";

const SENT_FILE = "sent.json";

let sent = [];

if (fs.existsSync(SENT_FILE)) {
  sent = JSON.parse(fs.readFileSync(SENT_FILE, "utf8"));
}

const users = await getUsers();

for (const category of config.categories) {

  const reels = await getReelsFromCategory(category);

  for (const reel of reels) {

    if (sent.includes(reel))
      continue;

    let file;

    try {

      file = await downloadReel(reel);

    } catch {

      continue;

    }

    for (const user of users) {

      try {

        await sendFile(user.chatId, file);

      } catch {

      }

    }

    sent.push(reel);

    fs.writeFileSync(
      SENT_FILE,
      JSON.stringify(sent, null, 2)
    );

    try {

      fs.unlinkSync(file);

    } catch {

    }

  }

}
