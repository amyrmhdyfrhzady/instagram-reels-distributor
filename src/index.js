import fs from "fs";
import run from "./main.js";

const USERS_FILE = "./database/users.json";
const SENT_FILE = "./database/sent.json";

if (!fs.existsSync("./database"))
  fs.mkdirSync("./database");

if (!fs.existsSync(USERS_FILE))
  fs.writeFileSync(USERS_FILE, "[]");

if (!fs.existsSync(SENT_FILE))
  fs.writeFileSync(SENT_FILE, "[]");

const users = JSON.parse(
  fs.readFileSync(USERS_FILE, "utf8")
);

const sent = new Set(
  JSON.parse(
    fs.readFileSync(SENT_FILE, "utf8")
  )
);

await run(users, sent);

fs.writeFileSync(
  SENT_FILE,
  JSON.stringify([...sent], null, 2)
);
