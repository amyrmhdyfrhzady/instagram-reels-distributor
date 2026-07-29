import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import { execSync } from 'child_process';

const configPath = './config.json';
let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const dbPath = './database.json';
let db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

// اطمینان از وجود ساختار فیلدهای جدید در دیتابیس
if (!db.reactions) db.reactions = {};
if (!db.sentReels) db.sentReels = [];
if (!db.users) db.users = [];

const BALE_BOT_TOKEN = process.env.BALE_BOT_TOKEN;
const STATE_PATH = './state.json';
const WATERMARK_PATH = './watermark.png'; // تصویر لوگوی شفاف برای واترمارک

function saveDb() {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function saveConfig() {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 🛠️ تابع ساخت Context و اعتبارسنجی لاگین
// 🎭 لیست User-Agentهای واقعی جهت چرخش و جلوگیری از بلاک
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getRandomViewport() {
  const widths = [1280, 1366, 1440, 1536, 1920];
  const heights = [720, 768, 900, 864, 1080];
  const idx = Math.floor(Math.random() * widths.length);
  return { width: widths[idx], height: heights[idx] };
}

// 🛠️ تابع ارتقایافته ضد بلاک (Anti-Detect)
async function createInstagramContext(browser, customOptions = {}) {
  const baseOptions = {
    userAgent: getRandomUserAgent(),
    viewport: getRandomViewport(),
    locale: 'en-US',
    timezoneId: 'America/New_York',
    ...customOptions
  };

  let context;
  
  const setupAntiDetect = async (ctx) => {
    // دور زدن المان‌های شناسایی اتومیشن
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
    });
  };

  if (fs.existsSync(STATE_PATH)) {
    try {
      context = await browser.newContext({
        ...baseOptions,
        storageState: STATE_PATH
      });
      await setupAntiDetect(context);

      const testPage = await context.newPage();
      try {
        await testPage.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await testPage.waitForTimeout(3000 + Math.random() * 2000); // تاخیر تصادفی انسانی

        const isLoggedIn = await testPage.evaluate(() => {
          const hasProfile = !!document.querySelector('img[alt*="profile"]');
          const hasNav = !!document.querySelector('svg[aria-label="Home"], svg[aria-label="خانه"]');
          const hasLoginForm = !!document.querySelector('input[name="username"]');
          return (hasProfile || hasNav) && !hasLoginForm;
        });

        await testPage.close();

        if (!isLoggedIn) {
          console.warn('⚠️ سشن منقضی شده یا کوکی sessionid معتبر نیست.');
          await context.close();
          const guestContext = await browser.newContext(baseOptions);
          await setupAntiDetect(guestContext);
          return { context: guestContext, isLoggedIn: false };
        }

        return { context, isLoggedIn: true };
      } catch (testErr) {
        await testPage.close();
        await context.close();
      }
    } catch (err) {
      console.warn(`⚠️ خطا در بارگذاری state.json: ${err.message}`);
    }
  }

  const guestContext = await browser.newContext(baseOptions);
  await setupAntiDetect(guestContext);
  return { context: guestContext, isLoggedIn: false };
}

// 👑 ایده ۳: دستورات پنل مدیریت ادمین + ثبت بازخورد (ایده ۶)
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
        const text = update.message?.text?.trim();
        const callbackQuery = update.callback_query;

        // ۱.۳ پردازش کلیک روی دکمه‌های شیشه‌ای لایک/دیس‌لایک
        if (callbackQuery) {
          const data = callbackQuery.data; // e.g., "like_REEL_ID" or "dislike_REEL_ID"
          const fromId = callbackQuery.from.id;

          if (data.startsWith('like_') || data.startsWith('dislike_')) {
            const [action, reelId] = data.split('_');
            if (!db.reactions[reelId]) db.reactions[reelId] = { likes: 0, dislikes: 0, users: {} };

            // ثبت واکنش کاربر
            if (!db.reactions[reelId].users[fromId]) {
              db.reactions[reelId].users[fromId] = action;
              if (action === 'like') db.reactions[reelId].likes++;
              else db.reactions[reelId].dislikes++;
              saveDb();

              await axios.post(`https://tapi.bale.ai/bot${BALE_BOT_TOKEN}/answerCallbackQuery`, {
                callback_query_id: callbackQuery.id,
                text: action === 'like' ? '👍 نظر شما ثبت شد!' : '👎 نظر شما ثبت شد.'
              });
            }
          }
          continue;
        }

        // ۲.۳ ثبت کاربر جدید
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

        // ۳.۳ دستورات ادمین
        const isAdmin = config.adminId && String(chatId) === String(config.adminId);
        if (isAdmin && text) {
          if (text === '/status') {
            await axios.post(`https://tapi.bale.ai/bot${BALE_BOT_TOKEN}/sendMessage`, {
              chat_id: chatId,
              text: `📊 **وضعیت ربات:**\n👥 تعداد کاربران: ${db.users.length}\n🎥 ریلزهای ارسالی: ${db.sentReels.length}\n📂 تعداد دسته‌بندی‌ها: ${config.categories.length}`
            });
          } else if (text.startsWith('/addcat ')) {
            const parts = text.split(' ');
            if (parts.length >= 3) {
              const name = parts[1];
              const url = parts[2];
              config.categories.push({ name, url, limit: 2 });
              saveConfig();
              await axios.post(`https://tapi.bale.ai/bot${BALE_BOT_TOKEN}/sendMessage`, {
                chat_id: chatId,
                text: `✅ دسته‌بندی جديد "${name}" اضافه شد.`
              });
            }
          } else if (text === '/stats') {
            let totalLikes = 0;
            let totalDislikes = 0;
            Object.values(db.reactions).forEach(r => {
              totalLikes += r.likes || 0;
              totalDislikes += r.dislikes || 0;
            });
            await axios.post(`https://tapi.bale.ai/bot${BALE_BOT_TOKEN}/sendMessage`, {
              chat_id: chatId,
              text: `📈 **آمار واکنش‌ها:**\n👍 کل لایک‌ها: ${totalLikes}\n👎 کل دیس‌لایک‌ها: ${totalDislikes}`
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('خطا در همگام‌سازی کاربران بله:', err.message);
  }
}

// استخراج لینک ریلزها از صفحات دسته‌بندی
async function extractReelsFromPage(browser, categoryUrl) {
  console.log(`📡 در حال باز کردن و استخراج HTML دسته‌بندی: ${categoryUrl}`);
  
  const { context, isLoggedIn } = await createInstagramContext(browser);
  const page = await context.newPage();
  let uniqueLinks = [];

  try {
    console.log(`🔑 وضعیت ورود دسته‌بندی: ${isLoggedIn ? 'با اکانت ✅' : 'بدون اکانت ❌'}`);
    await page.goto(categoryUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(5000);

    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, 1200));
      await page.waitForTimeout(2500);
    }

    const hrefs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a'))
        .map(a => a.href)
        .filter(href => href.includes('/reel/') || href.includes('/p/'));
    });

    const updatedHtmlContent = await page.content();
    const regex = /https?:\/\/(?:www\.)?instagram\.com\/(?:reel|p)\/([A-Za-z0-9_-]+)/g;
    let match;

    while ((match = regex.exec(updatedHtmlContent)) !== null) {
      hrefs.push(`https://www.instagram.com/reel/${match[1]}/`);
    }

    uniqueLinks = Array.from(new Set(hrefs.map(link => {
      const cleanMatch = link.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:reel|p)\/([A-Za-z0-9_-]+)/);
      return cleanMatch ? `https://www.instagram.com/reel/${cleanMatch[1]}/` : null;
    }).filter(Boolean)));

    console.log(`🔎 تعداد ریلزهای استخراج شده: ${uniqueLinks.length}`);
  } catch (err) {
    console.error(`💥 خطا در استخراج از دسته‌بندی: ${err.message}`);
  } finally {
    await context.close();
  }

  return uniqueLinks;
}

// استخراج ریلزهای تصادفی
async function extractRandomReels(browser, count = 5) {
  console.log(`\n🎲 در حال دریافت ${count} ریلز جدید...`);
  const foundLinks = [];
  let attempts = 0;
  const maxAttempts = count * 3;

  const { context, isLoggedIn } = await createInstagramContext(browser);
  console.log(
  `🔑 وضعیت ورود ریلز تصادفی: ${isLoggedIn ? 'با اکانت ✅' : 'بدون اکانت ❌'}`
);
  while (foundLinks.length < count && attempts < maxAttempts) {
    attempts++;
    const page = await context.newPage();

    try {
      await page.goto('https://www.instagram.com/reels/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(4000);

      const currentUrl = page.url();
      const match = currentUrl.match(/https?:\/\/(?:www\.)?instagram\.com\/reel(?:s)?\/([A-Za-z0-9_-]+)/);

      if (match) {
        const reelUrl = `https://www.instagram.com/reel/${match[1]}/`;
        if (!foundLinks.includes(reelUrl) && !db.sentReels.includes(reelUrl)) {
          foundLinks.push(reelUrl);
          console.log(`✨ لینک جدید یافت شد (${foundLinks.length}/${count}): ${reelUrl}`);
        }
      }
    } catch (err) {
      console.error(`❌ خطا در تلاش ${attempts}:`, err.message);
    } finally {
      await page.close();
    }
    await sleep(2000);
  }

  await context.close();
  return foundLinks;
}

// 🖌️ ایده ۴: چسباندن واترمارک روی ویدیو با استفاده از FFmpeg
function applyWatermark(inputPath) {
  if (!fs.existsSync(WATERMARK_PATH)) return inputPath; // اگر لوگو نبود، ویدیو دست‌نخورده برمی‌گردد

  const outputPath = inputPath.replace('.mp4', '_wm.mp4');
  try {
    console.log('🎨 در حال چسباندن واترمارک روی ویدیو...');
    // چسباندن واترمارک به گوشه بالا سمت راست (۱۰ پیکسل فاصله از لبه‌ها)
    execSync(`ffmpeg -y -i "${inputPath}" -i "${WATERMARK_PATH}" -filter_complex "overlay=main_w-overlay_w-10:10" "${outputPath}"`, { stdio: 'ignore' });
    
    fs.unlinkSync(inputPath); // حذف ویدیو بدون واترمارک
    return outputPath;
  } catch (err) {
    console.error('⚠️ خطا در اعمال واترمارک FFmpeg:', err.message);
    return inputPath;
  }
}

// 🔄 ایده ۵: دانلود از FastDL و سیستم دانلود رزرو (Fallback) با yt-dlp
// 🔄 تابع دانلود فوق‌سریع و هوشمند (ترکیب yt-dlp مستقیم + FastDL به عنوان پشتیبان)
async function downloadReel(browser, reelUrl) {
  const downloadsDir = path.resolve('./downloads');
  if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

  const MIN_FILE_SIZE_BYTES = 300 * 1024; // حداقل ۳۰۰ کیلوبایت
  const filePath = path.join(downloadsDir, `${Date.now()}_reel.mp4`);

  // 🚀 اولویت اول (سریع‌ترین روش): دانلود مستقیم با yt-dlp بدون باز کردن مرورگر
  console.log(`⚡ [yt-dlp] تلاش سریع برای دانلود: ${reelUrl}`);
  try {
    // اگر فایل state.json وجود داشته باشد، کوکی لاگین را استخراج می‌کنیم تا اینستاگرام بلاک نکند
    let cookieCmd = '';
    if (fs.existsSync(STATE_PATH)) {
      try {
        const stateData = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
        if (stateData.cookies) {
          const cookiePath = path.join(downloadsDir, 'cookies.txt');
          let cookieText = "# Netscape HTTP Cookie File\n";
          stateData.cookies.forEach(c => {
            cookieText += `${c.domain}\tTRUE\t${c.path}\t${c.secure ? 'TRUE' : 'FALSE'}\t${Math.floor(c.expires)}\t${c.name}\t${c.value}\n`;
          });
          fs.writeFileSync(cookiePath, cookieText);
          cookieCmd = `--cookies "${cookiePath}"`;
        }
      } catch (e) {
        // نادیده گرفتن خطای کوکی
      }
    }

    // اجرای مستقیم دستور سیستم‌عاملی yt-dlp (بدون npx) با تایم‌آوت ۱۵ ثانیه
    execSync(`yt-dlp ${cookieCmd} --no-warnings --socket-timeout 10 -o "${filePath}" "${reelUrl}"`, { 
      stdio: 'ignore',
      timeout: 20000 
    });

    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      if (stats.size >= MIN_FILE_SIZE_BYTES) {
        console.log(`✅ [yt-dlp] دانلود موفق زیر چند ثانیه: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
        return applyWatermark(filePath);
      } else {
        fs.unlinkSync(filePath);
      }
    }
  } catch (err) {
    console.warn(`⚠️ [yt-dlp] رد شد یا موفق نبود، رفتن سراغ FastDL...`);
    if (fs.existsSync(filePath)) try { fs.unlinkSync(filePath); } catch (e) {}
  }

  // 🛡️ اولویت دوم (پشتیبان): دانلود از FastDL با تایم‌آوت بسیار کوتاه جهت جلوگیری از اتلاف وقت
  console.log(`⏳ [FastDL Fallback] تلاش با وب‌سایت FastDL...`);
  const context = await browser.newContext({ 
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    // تایم‌آوت کوتاه ۱۰ ثانیه‌ای
    await page.goto('https://fastdl.app/fa', { waitUntil: 'domcontentloaded', timeout: 10000 });
    const inputSelector = 'input[type="search"], input[name="url"], input#search-form-input';
    
    await page.waitForSelector(inputSelector, { timeout: 5000 });
    await page.fill(inputSelector, reelUrl);

    const searchBtn = await page.locator('button[type="submit"], button.search-form__btn').first();
    await searchBtn.click();

    const downloadBtnSelector = 'a.button__download, a[download]';
    await page.waitForSelector(downloadBtnSelector, { timeout: 8000 });
    const downloadUrl = await page.getAttribute(downloadBtnSelector, 'href');

    if (downloadUrl) {
      const response = await axios({ method: 'GET', url: downloadUrl, responseType: 'stream', timeout: 30000 });
      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      await new Promise((res, rej) => { writer.on('finish', res); writer.on('error', rej); });
      await context.close();

      const stats = fs.statSync(filePath);
      if (stats.size >= MIN_FILE_SIZE_BYTES) {
        console.log(`✅ [FastDL] دانلود موفق: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
        return applyWatermark(filePath);
      } else {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    }
  } catch (err) {
    console.error(`❌ [FastDL] خطا یا تایم‌آوت FastDL: ${err.message}`);
    await context.close();
    if (fs.existsSync(filePath)) try { fs.unlinkSync(filePath); } catch (e) {}
  }

  return null;
}


// 📤 ارسال ویدیو به کاربران همراه با دکمه‌های شیشه‌ای لایک/دیس‌لایک (ایده ۶)
async function dispatchVideoToUsers(filePath, caption, reelUrl) {
  if (!BALE_BOT_TOKEN || db.users.length === 0) return;

  const reelId = reelUrl.match(/\/reel\/([A-Za-z0-9_-]+)/)?.[1] || Date.now();

  // ساخت کیبورد شیشه‌ای برای نظرسنجی/لایک
  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '👍 عالی بود', callback_data: `like_${reelId}` },
        { text: '👎 خوشم نیومد', callback_data: `dislike_${reelId}` }
      ]
    ]
  };

  for (const chatId of db.users) {
    try {
      const formData = new FormData();
      formData.append('chat_id', chatId);
      formData.append('caption', caption);
      formData.append('reply_markup', JSON.stringify(replyMarkup));
      formData.append('video', fs.createReadStream(filePath));

      await axios.post(`https://tapi.bale.ai/bot${BALE_BOT_TOKEN}/sendVideo`, formData, {
        headers: formData.getHeaders(),
        timeout: 90000
      });

      console.log(`📤 ویدیو به کاربر ${chatId} ارسال شد.`);
    } catch (err) {
      console.error(`⚠️ خطا در ارسال به ${chatId}:`, err.message);
    }
  }
}

// ۶. اجرای اصلی
async function main() {
  await syncAndWelcomeBaleUsers();

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
  });

  // ۱.۶ پردازش دسته‌بندی‌ها
  for (const category of config.categories) {
    console.log(`\n📂 شروع پردازش دسته‌بندی: ${category.name}`);

    try {
      const allExtractedLinks = await extractReelsFromPage(browser, category.url);
      const availableLinks = allExtractedLinks.filter((link) => !db.sentReels.includes(link));
      console.log(`✨ لینک‌های غیرتکراری آماده بررسی: ${availableLinks.length}`);

      const targetLimit = category.limit || 2;
      let successfulDispatches = 0;
      let linkIndex = 0;

      while (successfulDispatches < targetLimit && linkIndex < availableLinks.length) {
        const reelUrl = availableLinks[linkIndex];
        linkIndex++;

        console.log(`\n🎬 بررسی لینک (${linkIndex}/${availableLinks.length}) برای #${category.name}: ${reelUrl}`);
        const downloadedFilePath = await downloadReel(browser, reelUrl);

        if (downloadedFilePath && fs.existsSync(downloadedFilePath)) {
          await dispatchVideoToUsers(
            downloadedFilePath,
            `🎥 ریلز جدید از دسته‌بندی #${category.name}\n\n🔗 ${reelUrl}`,
            reelUrl
          );

          db.sentReels.push(reelUrl);
          saveDb();
          successfulDispatches++;

          console.log(`🎯 ارسال موفق (${successfulDispatches}/${targetLimit}) برای دسته‌بندی ${category.name}`);
          try { fs.unlinkSync(downloadedFilePath); } catch (e) {}
        } else {
          console.log(`⏭️ لینک ${reelUrl} به دلیل عدم دانلود یا حجم کم رد شد.`);
        }
      }

      console.log(`📊 نتیجه دسته‌بندی ${category.name}: ارسال ${successfulDispatches} از ${targetLimit} ریلز.`);

    } catch (err) {
      console.error(`💥 خطا در پردازش دسته‌بندی ${category.name}:`, err.message);
    }
  }

  // ۲.۶ پردازش ریلزهای تصادفی
  try {
    const randomTargetCount = config.randomReelsCount || 3;
    let randomDispatches = 0;

    console.log(`\n🎲 در حال دریافت و ارسال ${randomTargetCount} ریلز تصادفی معتبر...`);

    while (randomDispatches < randomTargetCount) {
      const randomLinks = await extractRandomReels(browser, 1);
      
      if (randomLinks.length === 0) {
        console.log('⚠️ ریلز تصادفی جدیدی یافت نشد.');
        break;
      }

      const reelUrl = randomLinks[0];
      const downloadedFilePath = await downloadReel(browser, reelUrl);

      if (downloadedFilePath && fs.existsSync(downloadedFilePath)) {
        await dispatchVideoToUsers(
          downloadedFilePath,
          `🔥 **ریلز داغ اینستاگرام**\n\n🔗 ${reelUrl}`,
          reelUrl
        );

        db.sentReels.push(reelUrl);
        saveDb();
        randomDispatches++;

        console.log(`🎯 ریلز تصادفی موفق (${randomDispatches}/${randomTargetCount})`);
        try { fs.unlinkSync(downloadedFilePath); } catch (e) {}
      } else {
        console.log(`⏭️ ریلز تصادفی ${reelUrl} رد شد.`);
      }
    }
  } catch (err) {
    console.error('💥 خطا در ریلزهای تصادفی:', err.message);
  }

  await browser.close();
  console.log('\n🏁 تمام مراحل به پایان رسید.');
}

main();
