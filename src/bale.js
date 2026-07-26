import axios from "axios";
import FormData from "form-data";
import fs from "fs";

import config from "./config.js";

export async function sendFile(chatId, file) {

  const form = new FormData();

  form.append("chat_id", chatId);

  form.append(
    "document",
    fs.createReadStream(file)
  );

  await axios.post(
    `https://tapi.bale.ai/bot${config.telegram.botToken}/sendDocument`,
    form,
    {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    }
  );

}
