import fs from "fs";
import path from "path";

export default async function downloadFromBlastUp(page, reelUrl) {

  await page.goto(
    "https://blastup.com/instagram-downloader",
    {
      waitUntil: "domcontentloaded"
    }
  );

  const downloadPromise = page.waitForEvent("download", {
    timeout: 60000
  });

  await page.fill("#link", reelUrl);

  await page.click("button[type=submit]");

  const download = await downloadPromise;

  const downloadsDir = path.resolve("downloads");

  if (!fs.existsSync(downloadsDir))
    fs.mkdirSync(downloadsDir);

  let filename = download.suggestedFilename();

  if (!filename)
    filename = `${Date.now()}.mp4`;

  const filePath = path.join(downloadsDir, filename);

  await download.saveAs(filePath);

  return filePath;

}
