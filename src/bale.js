import fs from "fs";

export default async function sendFile(userId, filePath) {

  const form = new FormData();

  form.append(
    "chat_id",
    userId
  );

  form.append(
    "document",
    new Blob([fs.readFileSync(filePath)]),
    filePath.split("/").pop()
  );

  const res = await fetch(

    `https://tapi.bale.ai/bot${process.env.BALE_BOT_TOKEN}/sendDocument`,

    {
      method: "POST",
      body: form
    }

  );

  if (!res.ok)
    throw new Error(await res.text());

  return await res.json();

}
