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

// تابع کمکی برای تاخیر
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ۱. مرحله اول: بررسی کاربران جدید بله و ارسال پیام ثبت‌نام
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
        const text = update.message?.text;

        // ثبت کاربر جدید
        if (chatId && !db.users.includes(chatId)) {
          db.users.push(chatId);
          saveDb();
          console.log(`👤 کاربر جدید شناسایی شد: ${chatId}`);

          // ارسال پیام ثبت‌نام موفقیت‌آمیز
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

// ۲. ذخیره MHTML و استخراج لینک‌های ریلز
async function extractReelsFromMhtml(page, categoryUrl) {
  console.log(`📡 در حال باز کردن دسته‌بندی: ${categoryUrl}`);
  await page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);

  // استخراج فایل MHTML از تب جاری
  const cdp = await page.context().newCDPSession(page);
  const { data: mhtmlContent } = await cdp.send('Page.captureSnapshot', { format: 'mhtml' });

  // ذخیره موقت فایل MHTML (اختیاری)
  fs.writeFileSync('./temp_page.mhtml', mhtmlContent);

  // استخراج لینک‌های ریلز با Regex از سورس MHTML
  const reelRegex = /https?:\/\/(?:www\.)?instagram\.com\/reel\/([A-Za-z0-9_-]+)/g;
  const foundLinks = new Set();
  let match;

  while ((match = reelRegex.exec(mhtmlContent)) !== null) {
    const cleanLink = `https://www.instagram.com/reel/${match[1]}/`;
    foundLinks.add(cleanLink);
  }

  console.log(`🔎 تعداد کل ریلزهای یافت شده در صفحه: ${foundLinks.size}`);
  return Array.from(foundLinks);
}

// ۳. دانلود از BlastUp با ۳ بار تلاش (Retry)
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

      // پر کردن اینپوت مشخص‌شده
      const inputSelector = 'input#link.form-control';
      await page.waitForSelector(inputSelector, { timeout: 15000 });
      await page.fill(inputSelector, reelUrl);

      // آماده‌سازی شنود رویداد دانلود قبل از کلیک روی دکمه
      const downloadPromise = page.waitForEvent('download', { timeout: 30000 });

      // کلیک روی دکمه سابمیت
      const buttonSelector = 'button.btn--purple[type="submit"]';
      await page.click(buttonSelector);

      // انتظار برای شروع دانلود خودکار
      const download = await downloadPromise;
      const filePath = path.join(downloadsDir, `${Date.now()}_${await download.suggestedFilename()}`);
      await download.saveAs(filePath);

      await context.close();
      console.log(`✅ دانلود با موفقیت انجام شد: ${filePath}`);
      return filePath;
    } catch (err) {
      console.error(`❌ تلاش ${attempt} ناموفق بود (${err.message})`);
      await context.close();
      await sleep(3000); // تاخیر بین تلاش‌ها
    }
  }

  console.error(`🛑 تمام ۳ تلاش برای دانلود لینک ${reelUrl} با شکست مواجه شد. رفتن به لینک بعدی...`);
  return null;
}

// ۴. ارسال ویدیو به کاربران بله با ۳ بار تلاش برای هر کاربر
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

        console.log(`📤 ویدیو با موفقیت به کاربر ${chatId} ارسال شد.`);
        sentSuccessfully = true;
        break; // خروج از حلقه retry
      } catch (err) {
        console.error(`⚠️ تلاش ${attempt} برای ارسال به ${chatId} ناموفق بود.`);
        await sleep(2000);
      }
    }

    if (!sentSuccessfully) {
      console.log(`🚫 ارسال به کاربر ${chatId} پس از ۳ بار تلاش ناموفق بود (احتمال بلاک). سیستم از این کاربر رد می‌شود.`);
      // کاربر در دیتابیس باقی می‌ماند اما اجرا متوقف نمی‌شود
    }
  }
}

// ۵. جریان اصلی برنامه (Main)
async function main() {
  // مرحله ۱: دریافت و خوش‌آمدگویی به کاربران جدید
  await syncAndWelcomeBaleUsers();

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  // پیمایش دسته‌بندی‌ها
  for (const category of config.categories) {
    console.log(`\n====================================`);
    console.log(`📂 شروع پردازش دسته‌بندی: ${category.name}`);
    console.log(`====================================`);

    try {
      const allExtractedLinks = await extractReelsFromMhtml(page, category.url);

      // فیلتر کردن لینک‌هایی که قبلاً ارسال شده‌اند
      const newLinks = allExtractedLinks.filter((link) => !db.sentReels.includes(link));
      console.log(`✨ لینک‌های جدید و غیرتکراری: ${newLinks.length}`);

      // اعمال محدودیت تعداد ارسال برای هر دسته‌بندی
      const targetLinks = newLinks.slice(0, config.maxReelsPerCategory);

      for (const reelUrl of targetLinks) {
        // دانلود ویدیو از BlastUp
        // کد جدید:
      const targetLinks = newLinks.slice(0, category.limit || 2);


        if (downloadedFilePath && fs.existsSync(downloadedFilePath)) {
          // ارسال به تمام کاربران بله
          await dispatchVideoToUsers(
            downloadedFilePath,
            `🎥 ریلز جدید از دسته‌بندی #${category.name}\n\n🔗 ${reelUrl}`
          );

          // ذخیره لینک در دیتابیس برای جلوگیری از ارسال مجدد در کرون‌های بعدی
          db.sentReels.push(reelUrl);
          saveDb();

          // پاکسازی فایل بعد از ارسال
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
