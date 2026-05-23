const puppeteer = require('puppeteer');
const path = require('path');

const outputDir = 'C:\\Users\\Hp\\.gemini\\antigravity\\brain\\5c438088-0345-4300-ac23-4cf01bf5c452';
const pages = [
  { url: 'http://localhost:3000/', file: 'screenshot_home.png' },
  { url: 'http://localhost:3000/closer.html', file: 'screenshot_closer.png' },
  { url: 'http://localhost:3000/admin.html', file: 'screenshot_admin.png' },
];

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  for (const page of pages) {
    const tab = await browser.newPage();
    await tab.setViewport({ width: 1440, height: 900 });
    console.log(`Navigating to ${page.url}...`);
    await tab.goto(page.url, { waitUntil: 'networkidle2', timeout: 30000 });
    // Wait 2 seconds for fonts/CSS to load
    await new Promise(r => setTimeout(r, 2000));
    const savePath = path.join(outputDir, page.file);
    await tab.screenshot({ path: savePath, fullPage: true });
    console.log(`Saved: ${savePath}`);
    await tab.close();
  }

  await browser.close();
  console.log('All screenshots taken!');
})();
