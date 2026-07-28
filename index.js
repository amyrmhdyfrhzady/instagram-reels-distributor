import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const dbPath = './database.json';
let db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

const BALE_BOT_TOKEN = process.env.BALE_BOT_TOKEN;
const STATE_PATH = './state.json'; // 🔑 مسیر فایل کوکی‌های اکانت

function saveDb() {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 🛠️ تابع کمکی اصلاح‌شده برای بررسی دقیق و واقعی لاگین بودن اکانت
async function createInstagramContext(browser, customOptions = {}) {
  const baseOptions = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    ...customOptions
  };

  if (fs.existsSync(STATE_PATH)) {
    try {
      const context = await browser.newContext({
        ...baseOptions,
        storageState: STATE_PATH
      });
      
      // تست واقعی اینکه آیا سشن معتبر است یا خیر
      const testPage = await context.newPage();
      try {
        await testPage.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
        await testPage.waitForTimeout(3000);
        const currentUrl = testPage.url();
        await testPage.close();

        // اگر به صفحه لاگین ریدایرکت شد یعنی کوکی نامعتبر یا سشن خالی است
        if (currentUrl.includes('/accounts/login/')) {
          console.warn('⚠️ فایل state.json موجود است اما سشن منقضی شده یا Session ID نامعتبر/خالی است.');
          await context.close();
          const guestContext = await browser.newContext(baseOptions);
          return { context: guestContext, isLoggedIn: false };
        }

        return { context, isLoggedIn: true };
      } catch (testErr) {
        await testPage.close();
        await context.close();
      }
    } catch (err) {
      console.warn(`⚠️ خطا در بارگذاری اکانت از ${STATE_PATH}: ${err.message}`);
    }
  } else {
    console.log('ℹ️ فایل state.json یافت نشد؛ ورود به‌صورت بدون لاگین (مهمان) انجام می‌شود.');
  }

  const context = await browser.newContext(baseOptions);
  return { context, isLoggedIn: false };
}

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
            if (e.response && e.response.status === 403) {
              console.warn(`⚠️ کاربر ${chatId} ربات را بلاک کرده یا دسترسی ندارد.`);
            } else {
              console.error(`خطا در ارسال پیام خوش‌آمدگویی به ${chatId}:`, e.message);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('خطا در همگام‌سازی کاربران بله:', err.message);
  }
}

// 🎯 بخش استخراج ریلزهای تصادفی با قابلیت تلاش برای ورود با اکانت
async function extractRandomReels(browser, count = 5) {
  console.log(`\n🎲 در حال دریافت ${count} ریلز جدید و غیرتکراری از بخش عمومی...`);
  const foundLinks = [];
  let attempts = 0;
  const maxAttempts = count * 3;

  while (foundLinks.length < count && attempts < maxAttempts) {
    attempts++;
    
    const { context, isLoggedIn } = await createInstagramContext(browser);
    const page = await context.newPage();

    try {
      console.log(`🔄 تلاش ${attempts} (یافته شده: ${foundLinks.length} از ${count}) | وضعیت: ${isLoggedIn ? '🔑 با اکانت' : '🌐 بدون اکانت'}`);
      
      await page.goto('https://www.instagram.com/reels/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(4000);

      const currentUrl = page.url();
      const match = currentUrl.match(/https?:\/\/(?:www\.)?instagram\.com\/reel(?:s)?\/([A-Za-z0-9_-]+)/);

      if (match) {
        const reelUrl = `https://www.instagram.com/reel/${match[1]}/`;
        
        const isAlreadyInList = foundLinks.includes(reelUrl);
        const isAlreadyInDb = db.sentReels.includes(reelUrl);

        if (!isAlreadyInList && !isAlreadyInDb) {
          foundLinks.push(reelUrl);
          console.log(`✨ لینک جدید و خالص پیدا شد (${foundLinks.length}/${count}): ${reelUrl}`);
        }
      }
    } catch (err) {
      console.error(`❌ خطا در تلاش ${attempts}:`, err.message);
    } finally {
      await context.close();
    }

    await sleep(2000);
  }

  return foundLinks;
}

// ۲. استخراج لینک ریلزها از طریق دانلود و تحلیل ساختار HTML صفحه دسته‌بندی
async function extractReelsFromPage(browser, categoryUrl) {
  console.log(`📡 در حال باز کردن و استخراج HTML دسته‌بندی: ${categoryUrl}`);
  
  const { context, isLoggedIn } = await createInstagramContext(browser);
  const page = await context.newPage();

  let uniqueLinks = [];

  try {
    console.log(`🔑 وضعیت ورود دسته‌بندی: ${isLoggedIn ? 'با اکانت' : 'بدون اکانت'}`);
    await page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(6000);

    // 🔍 --- بخش دیباگ جدید ---
    const pageTitle = await page.title();
    const pageHtml = await page.content();
    console.log(`📌 [دیباگ] عنوان صفحه: "${pageTitle}"`);
    console.log(`📄 [دیباگ] ۵۰۰ کاراکتر اول HTML:\n${pageHtml.substring(0, 500)}...\n---`);

    // ذخیره اسکرین‌شات از صفحه‌ای که مرورگر در حال دیدن آن است
    const screenshotPath = `debug-${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`📸 [دیباگ] اسکرین‌شات ذخیره شد: ${screenshotPath}`);
    // ----------------------------

    // اسکرول ملایم برای لود شدن محتوای داینامیک صفحه
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 1000));
      await page.waitForTimeout(2000);
    }

    // دریافت کامل سورس HTML صفحه (مجدداً بعد از اسکرول)
    const updatedHtmlContent = await page.content();
    
    // روش مبتنی بر Regex روی کل کدهای HTML برای استخراج دقیق لینک‌های ریلز
    const regex = /https?:\/\/(?:www\.)?instagram\.com\/reel\/([A-Za-z0-9_-]+)/g;
    let match;
    const extractedMatches = [];

    while ((match = regex.exec(updatedHtmlContent)) !== null) {
      extractedMatches.push(`https://www.instagram.com/reel/${match[1]}/`);
    }

    uniqueLinks = Array.from(new Set(extractedMatches));
    console.log(`🔎 تعداد ریلزهای استخراج شده از HTML: ${uniqueLinks.length}`);
  } catch (err) {
    console.error(`💥 خطا در استخراج از دسته‌بندی: ${err.message}`);
  } finally {
    await context.close();
  }

  return uniqueLinks;
}

// ۳. دانلود از سرویس FastDL (دست‌نخورده)
async function downloadReel(browser, reelUrl) {
  const downloadsDir = path.resolve('./downloads');
  if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`⏳ تلاش ${attempt} از ۳ برای دانلود ریلز: ${reelUrl}`);
    
    const context = await browser.newContext({ 
      acceptDownloads: true,
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
      await page.goto('https://fastdl.app/fa', { waitUntil: 'domcontentloaded', timeout: 30000 });

      const inputSelector = 'input[type="search"], input[name="url"], input#search-form-input';
      await page.waitForSelector(inputSelector, { timeout: 15000 });
      await page.fill(inputSelector, reelUrl);

      const searchBtn = await page.locator('button[type="submit"], button.search-form__btn').first();
      await searchBtn.click();

      const downloadBtnSelector = 'a.button__download, a[download]';
      await page.waitForSelector(downloadBtnSelector, { timeout: 25000 });

      const downloadUrl = await page.getAttribute(downloadBtnSelector, 'href');

      if (!downloadUrl) {
        throw new Error('لینک دانلود ویدیو یافت نشد.');
      }

      const filePath = path.join(downloadsDir, `${Date.now()}_reel.mp4`);
      
      const response = await axios({
        method: 'GET',
        url: downloadUrl,
        responseType: 'stream',
        timeout: 60000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        }
      });

      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      await context.close();
      console.log(`✅ دانلود با موفقیت انجام شد: ${filePath}`);
      return filePath;

    } catch (err) {
      console.error(`❌ تلاش ${attempt} ناموفق بود: ${err.message}`);
      await context.close();
      await sleep(4000);
    }
  }

  console.error(`🛑 دانلود لینک ${reelUrl} پس از ۳ بار تلاش ناموفق بود.`);
  return null;
}

// ۴. ارسال ویدیو به کاربران بله (دست‌نخورده)
async function dispatchVideoToUsers(filePath, caption) {
  if (!BALE_BOT_TOKEN || db.users.length === 0) {
    console.log('⚠️ کاربری برای ارسال یافت نشد یا توکن بله تنظیم نیست.');
    return;
  }

  for (const chatId of db.users) {
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
        break;
      } catch (err) {
        if (err.response && err.response.status === 403) {
          console.warn(`🚫 کاربر ${chatId} ربات را بلاک کرده است.`);
          break;
        }
        console.error(`⚠️ تلاش ${attempt} برای ارسال به ${chatId} ناموفق بود: ${err.message}`);
        await sleep(2000);
      }
    }
  }
}

// ۵. اجرای اصلی
async function main() {
  await syncAndWelcomeBaleUsers();

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  // ۱.۵. اجرای پردازش دسته‌بندی‌ها
  for (const category of config.categories) {
    console.log(`\n📂 شروع پردازش دسته‌بندی: ${category.name}`);

    try {
      const allExtractedLinks = await extractReelsFromPage(browser, category.url);

      const newLinks = allExtractedLinks.filter((link) => !db.sentReels.includes(link));
      console.log(`✨ لینک‌های جدید: ${newLinks.length}`);

      const limit = category.limit || 2;
      const targetLinks = newLinks.slice(0, limit);

      for (const reelUrl of targetLinks) {
        const downloadedFilePath = await downloadReel(browser, reelUrl);

        if (downloadedFilePath && fs.existsSync(downloadedFilePath)) {
          await dispatchVideoToUsers(
            downloadedFilePath,
            `🎥 ریلز جدید از دسته‌بندی #${category.name}\n\n🔗 ${reelUrl}`
          );

          db.sentReels.push(reelUrl);
          saveDb();

          try {
            fs.unlinkSync(downloadedFilePath);
          } catch (e) {}
        }
      }
    } catch (err) {
      console.error(`💥 خطا در پردازش دسته‌بندی ${category.name}:`, err.message);
    }
  }

  // ۲.۵. اجرای بخش ریلزهای تصادفی
  try {
    const randomCount = config.randomReelsCount || 3;
    const randomReelLinks = await extractRandomReels(browser, randomCount);

    for (const reelUrl of randomReelLinks) {
      console.log(`🎬 در حال پردازش و دانلود: ${reelUrl}`);
      
      const downloadedFilePath = await downloadReel(browser, reelUrl);

      if (downloadedFilePath && fs.existsSync(downloadedFilePath)) {
        await dispatchVideoToUsers(
          downloadedFilePath,
          `🔥 **ریلز داغ اینستاگرام**\n\n🔗 ${reelUrl}`
        );

        db.sentReels.push(reelUrl);
        saveDb();

        try {
          fs.unlinkSync(downloadedFilePath);
        } catch (e) {}
      }
    }
  } catch (err) {
    console.error('💥 خطا در اجرای بخش ریلزهای تصادفی:', err.message);
  }

  await browser.close();
  console.log('\n🏁 تمام مراحل به پایان رسید.');
}

main();
