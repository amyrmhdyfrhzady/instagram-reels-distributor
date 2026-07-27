import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const dbPath = './database.json';
let db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

const BALE_BOT_TOKEN = process.env.BALE_BOT_TOKEN;

function saveDb() {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ۱. همگام‌سازی کاربران بله
async function syncAndWelcomeBaleUsers() {
  if (!BALE_BOT_TOKEN) {
    console.log('⚠️ توکن بله یافت نشد.');
    return;
  }

  try {
    const res = await axios.get(`https://tapi.bale.ai/bot${BALE_BOT_TOKEN}/getUpdates`);
    if (res.data && res.data.ok) {
      for (const update of res.data.result) {
        const chatId = update.message?.chat?.id;

        if (chatId && !db.users.includes(chatId)) {
          db.users.push(chatId);
          saveDb();
          console.log(`👤 کاربر جدید شناسایی شد: ${chatId}`);

          try {
            await axios.post(`https://tapi.bale.ai/bot${BALE_BOT_TOKEN}/sendMessage`, {
              chat_id: chatId,
              text: 'ثبت‌نام شما با موفقیت انجام شد! از این پس ریلزهای جدید برای شما ارسال می‌شوند.'
            });
          } catch (e) {
            console.error(`خطا در ارسال پیام خوش‌آمدگویی به ${chatId}:`, e.message);
          }
        }
      }
    }
  } catch (err) {
    console.error('خطا در همگام‌سازی کاربران بله:', err.message);
  }
}

// ۲. استخراج لینک ریلزها مستقیماً از DOM (جایگزین روش MHTML جهت جلوگیری از شکستن لینک‌ها)
async function extractReelsFromPage(page, categoryUrl) {
  console.log(`📡 در حال باز کردن دسته‌بندی: ${categoryUrl}`);
  await page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  // اسکرول کوتاه برای لود شدن پست‌ها
  await page.evaluate(() => window.scrollBy(0, 1000));
  await page.waitForTimeout(2000);

  // استخراج تمام <a>هایی که آدرس ریلز دارند
  const reelLinks = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href*="/reel/"]'));
    return anchors.map(a => {
      const match = a.href.match(/https?:\/\/(?:www\.)?instagram\.com\/reel\/([A-Za-z0-9_-]+)/);
      return match ? `https://www.instagram.com/reel/${match[1]}/` : null;
    }).filter(Boolean);
  });

  const uniqueLinks = Array.from(new Set(reelLinks));
  console.log(`🔎 تعداد ریلزهای یافت شده: ${uniqueLinks.length}`);
  return uniqueLinks;
}

// ۳. دانلود از BlastUp با ۳ بار تلاش
async function downloadWithBlastup(browser, reelUrl) {
  const downloadsDir = path.resolve('./downloads');
  if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir);

  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`⏳ تلاش ${attempt} از ۳ برای دانلود ریلز: ${reelUrl}`);
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();

    try {
      await page.goto('https://blastup.com/instagram-downloader', {
        waitUntil: 'networkidle',
        timeout: 45000
      });

      const inputSelector = 'input#link.form-control';
      await page.waitForSelector(inputSelector, { timeout: 15000 });
      await page.fill(inputSelector, reelUrl);

      const downloadPromise = page.waitForEvent('download', { timeout: 30000 });

      const buttonSelector = 'button.btn--purple[type="submit"]';
      await page.click(buttonSelector);

      const download = await downloadPromise;
      const filePath = path.join(downloadsDir, `${Date.now()}_${await download.suggestedFilename()}`);
      await download.saveAs(filePath);

      await context.close();
      console.log(`✅ دانلود با موفقیت انجام شد: ${filePath}`);
      return filePath;
    } catch (err) {
      console.error(`❌ تلاش ${attempt} ناموفق بود (${err.message})`);
      await context.close();
      await sleep(3000);
    }
  }

  console.error(`🛑 دانلود لینک ${reelUrl} پس از ۳ بار تلاش ناموفق بود.`);
  return null;
}

// ۴. ارسال ویدیو به بله
async function dispatchVideoToUsers(filePath, caption) {
  if (!BALE_BOT_TOKEN || db.users.length === 0) {
    console.log('⚠️ کاربری برای ارسال یافت نشد یا توکن بله تنظیم نیست.');
    return;
  }

  for (const chatId of db.users) {
    let sentSuccessfully = false;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('caption', caption);
        formData.append('video', fs.createReadStream(filePath));

        await axios.post(`https://tapi.bale.ai/bot${BALE_BOT_TOKEN}/sendVideo`, formData, {
          headers: formData.getHeaders(),
          timeout: 90000
        });

        console.log(`📤 ویدیو به کاربر ${chatId} ارسال شد.`);
        sentSuccessfully = true;
        break;
      } catch (err) {
        console.error(`⚠️ تلاش ${attempt} برای ارسال به ${chatId} ناموفق بود.`);
        await sleep(2000);
      }
    }

    if (!sentSuccessfully) {
      console.log(`🚫 ارسال به کاربر ${chatId} ناموفق بود (احتمال بلاک). سیستم رد می‌شود.`);
    }
  }
}

// ۵. اجرای اصلی
async function main() {
  await syncAndWelcomeBaleUsers();

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  for (const category of config.categories) {
    console.log(`\n📂 شروع پردازش دسته‌بندی: ${category.name}`);

    try {
      const allExtractedLinks = await extractReelsFromPage(page, category.url);

      const newLinks = allExtractedLinks.filter((link) => !db.sentReels.includes(link));
      console.log(`✨ لینک‌های جدید: ${newLinks.length}`);

      // استفاده از limit اختصاصی هر کتگوری
      const limit = category.limit || 2;
      const targetLinks = newLinks.slice(0, limit);

      for (const reelUrl of targetLinks) {
        const downloadedFilePath = await downloadWithBlastup(browser, reelUrl);

        if (downloadedFilePath && fs.existsSync(downloadedFilePath)) {
          await dispatchVideoToUsers(
            downloadedFilePath,
            `🎥 ریلز جدید از دسته‌بندی #${category.name}\n\n🔗 ${reelUrl}`
          );

          db.sentReels.push(reelUrl);
          saveDb();

          fs.unlinkSync(downloadedFilePath);
        }
      }
    } catch (err) {
      console.error(`💥 خطا در پردازش دسته‌بندی ${category.name}:`, err.message);
    }
  }

  await browser.close();
  console.log('\n🏁 تمام مراحل به پایان رسید.');
}

main();
