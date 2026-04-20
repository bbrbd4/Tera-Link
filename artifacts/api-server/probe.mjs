import { chromium } from "playwright-core";

const SHORTURL = "4hUn53rUuPQhBxl-xo188g";
const PARENT_DIR = "/KOWALSTOD/APRIL 26/20/Ailen Tiktok/Motopen";
const FILE_NAME = "9.mp4";

const browser = await chromium.launch({
  executablePath: "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
});

const ctx = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36",
  viewport: { width: 1280, height: 800 },
  locale: "en-US",
});
const page = await ctx.newPage();

const captured = [];
page.on("response", async (resp) => {
  const url = resp.url();
  if (
    url.includes("/share/download") ||
    url.includes("/share/streaming") ||
    url.includes("/api/streaming") ||
    url.includes("/share/list") ||
    url.includes("/share/multimediafile") ||
    url.includes("/api/sharedownload") ||
    url.includes("/api/file/getinfo") ||
    url.includes("data.terabox.com/file") ||
    url.includes(".m3u8")
  ) {
    try {
      const ct = resp.headers()["content-type"] || "";
      const text = ct.includes("json") || ct.includes("text") ? await resp.text() : "(binary)";
      captured.push({ url, status: resp.status(), body: text.slice(0, 600) });
    } catch {}
  }
});

const target = `https://www.terabox.com/sharing/link?surl=${SHORTURL}`;
console.log("→ goto:", target);
await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(6000);

console.log("page url:", page.url());
console.log("title:", await page.title());

// snapshot what's on the page
const text = await page.evaluate(() => document.body.innerText.slice(0, 2000));
console.log("\nbody text head:\n", text);

console.log("\n=== captured network so far ===");
for (const c of captured) console.log(c.status, c.url.slice(0, 120), "\n", c.body.slice(0, 300), "\n---");

// try to find the first folder and click it
const folder = await page.locator("text=KOWALSTOD").first();
const folderCount = await folder.count();
console.log("KOWALSTOD link count:", folderCount);
if (folderCount > 0) {
  await folder.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(4000);
  console.log("after click url:", page.url());
}

await page.screenshot({ path: "/tmp/tb1.png", fullPage: false });
console.log("screenshot saved /tmp/tb1.png");

await browser.close();
console.log("\n=== final captured ===");
for (const c of captured) console.log(c.status, c.url.slice(0, 120));
