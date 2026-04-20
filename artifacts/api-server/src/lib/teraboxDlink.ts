import {
  getDlinkViaSession,
  hasNdusCookie,
  invalidateSession,
  type DlinkInfo,
} from "./teraboxBrowser";
import { logger } from "./logger";

const dlinkCache = new Map<string, { info: DlinkInfo; expiresAt: number }>();
const MAX_CACHE = 500;

export type { DlinkInfo };

function pruneCache() {
  if (dlinkCache.size <= MAX_CACHE) return;
  const now = Date.now();
  for (const [k, v] of dlinkCache) {
    if (v.expiresAt <= now) dlinkCache.delete(k);
  }
  while (dlinkCache.size > MAX_CACHE) {
    const oldest = dlinkCache.keys().next().value;
    if (oldest === undefined) break;
    dlinkCache.delete(oldest);
  }
}

const TRANSIENT = /errno=(-6|-7|400141|400142)/;

export async function extractTeraboxDlink(
  shorturl: string,
  parentDir: string,
  fsId: string
): Promise<DlinkInfo> {
  if (!hasNdusCookie()) {
    throw new Error("Server is not configured for direct downloads.");
  }
  const cacheKey = `${shorturl}|${parentDir}|${fsId}`;
  const cached = dlinkCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.info;

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const info = await getDlinkViaSession(shorturl, parentDir, fsId);
      dlinkCache.set(cacheKey, {
        info,
        expiresAt: Date.now() + 8 * 60 * 1000,
      });
      pruneCache();
      return info;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === 0 && TRANSIENT.test(msg)) {
        logger.warn({ err, attempt }, "Transient TeraBox error — retrying with fresh session");
        invalidateSession(shorturl);
        continue;
      }
      break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Failed to extract download link");
}
