import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright-core";
import { logger } from "./logger";

const NDUS = process.env["TERABOX_NDUS_COOKIE"] || "";
const CHROMIUM_PATH =
  process.env["CHROMIUM_PATH"] ||
  "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

const SESSION_TTL_MS = 4 * 60 * 1000;

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({
        executablePath: CHROMIUM_PATH,
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--disable-blink-features=AutomationControlled",
          "--disable-gpu",
        ],
      })
      .then((b) => {
        b.on("disconnected", () => {
          browserPromise = null;
        });
        return b;
      })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

interface PageSession {
  ctx: BrowserContext;
  page: Page;
  jsToken: string;
  expiresAt: number;
}

const sessionCache = new Map<string, Promise<PageSession>>();

export function hasNdusCookie(): boolean {
  return !!NDUS;
}

async function createSession(shorturl: string): Promise<PageSession> {
  if (!NDUS) throw new Error("TERABOX_NDUS_COOKIE not set");
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1366, height: 800 },
    locale: "en-US",
  });
  let cleanedUp = false;
  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    await ctx.close().catch(() => {});
  };
  try {
    await ctx.addCookies([
      {
        name: "ndus",
        value: NDUS,
        domain: ".terabox.com",
        path: "/",
        secure: true,
        httpOnly: true,
      },
      {
        name: "lang",
        value: "en",
        domain: ".terabox.com",
        path: "/",
        secure: false,
        httpOnly: false,
      },
    ]);
    const page = await ctx.newPage();
    await page.goto(`https://www.terabox.com/sharing/link?surl=${shorturl}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page
      .waitForFunction(
        () => !!(globalThis as { jsToken?: unknown }).jsToken,
        undefined,
        { timeout: 15000 }
      )
      .catch(() => {});
    const jsToken = await page.evaluate(
      () => (globalThis as { jsToken?: string }).jsToken || ""
    );
    if (!jsToken) throw new Error("Failed to extract jsToken");

    logger.info({ shorturl }, "TeraBox session ready");
    const session: PageSession = {
      ctx,
      page,
      jsToken,
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    setTimeout(() => {
      sessionCache.delete(shorturl);
      void cleanup();
    }, SESSION_TTL_MS).unref();
    return session;
  } catch (err) {
    await cleanup();
    throw err;
  }
}

export function invalidateSession(shorturl: string): void {
  const cached = sessionCache.get(shorturl);
  sessionCache.delete(shorturl);
  if (cached) {
    void cached.then((s) => s.ctx.close().catch(() => {})).catch(() => {});
  }
}

async function getOrCreateSession(shorturl: string): Promise<PageSession> {
  const cached = sessionCache.get(shorturl);
  if (cached) {
    const s = await cached.catch(() => null);
    if (s && s.expiresAt > Date.now()) return s;
    sessionCache.delete(shorturl);
  }
  const p = createSession(shorturl);
  sessionCache.set(shorturl, p);
  p.catch((err) => {
    logger.warn({ err, shorturl }, "TeraBox session failed");
    sessionCache.delete(shorturl);
  });
  return p;
}

export interface DlinkInfo {
  dlink: string;
  filename?: string;
  size?: number;
}

interface ShareListItem {
  fs_id: number | string;
  server_filename?: string;
  size?: number;
  dlink?: string;
}

export async function getDlinkViaSession(
  shorturl: string,
  parentDir: string,
  fsId: string
): Promise<DlinkInfo> {
  const s = await getOrCreateSession(shorturl);
  const result = await s.page.evaluate(
    async ({
      token,
      surl,
      dir,
    }: {
      token: string;
      surl: string;
      dir: string;
    }) => {
      const r = await fetch(
        `/share/list?app_id=250528&web=1&channel=dubox&clienttype=0&shorturl=${surl}&dir=${encodeURIComponent(dir)}&order=time&desc=1&showempty=0&jsToken=${token}`,
        { credentials: "include" }
      );
      const text = await r.text();
      try {
        return { json: JSON.parse(text) as unknown };
      } catch {
        return { error: `Bad JSON: ${text.substring(0, 200)}` };
      }
    },
    { token: s.jsToken, surl: shorturl, dir: parentDir }
  );
  if ("error" in result && result.error) throw new Error(result.error);
  const data = (result as { json: { errno: number; list?: ShareListItem[] } })
    .json;
  if (data.errno !== 0 || !data.list) {
    throw new Error(`share/list errno=${data.errno}`);
  }
  const file = data.list.find((it) => String(it.fs_id) === String(fsId));
  if (!file || !file.dlink) {
    throw new Error("File not found in folder listing");
  }
  return {
    dlink: file.dlink,
    filename: file.server_filename,
    size: file.size,
  };
}
