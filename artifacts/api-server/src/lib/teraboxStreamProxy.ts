import https from "node:https";
import { URL } from "node:url";
import type { Request, Response } from "express";
import { logger } from "./logger";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

const FORWARD_RES_HEADERS = new Set([
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "last-modified",
  "etag",
  "cache-control",
]);

const MAX_REDIRECTS = 5;

function makeUpstreamRequest(
  url: string,
  range: string | undefined,
  redirectsLeft: number
): Promise<import("node:http").IncomingMessage> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers: Record<string, string> = {
      "User-Agent": UA,
      Referer: "https://www.terabox.com/",
      Accept: "*/*",
      "Accept-Encoding": "identity",
    };
    if (range) headers["Range"] = range;

    const req = https.request(
      {
        method: "GET",
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        headers,
      },
      (resp) => {
        const status = resp.statusCode || 0;
        if (status >= 300 && status < 400 && resp.headers.location) {
          if (redirectsLeft <= 0) {
            reject(new Error("Too many redirects"));
            resp.resume();
            return;
          }
          const next = new URL(resp.headers.location, url).toString();
          resp.resume();
          makeUpstreamRequest(next, range, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        resolve(resp);
      }
    );
    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error("Upstream timeout"));
    });
    req.end();
  });
}

export async function proxyTeraboxDlink(
  dlink: string,
  filename: string | undefined,
  forceDownload: boolean,
  req: Request,
  res: Response
): Promise<void> {
  const range = typeof req.headers["range"] === "string" ? req.headers["range"] : undefined;
  let upstream: import("node:http").IncomingMessage;
  try {
    upstream = await makeUpstreamRequest(dlink, range, MAX_REDIRECTS);
  } catch (err) {
    logger.warn({ err }, "Upstream request failed");
    if (!res.headersSent) res.status(502).end("Upstream fetch failed");
    return;
  }

  res.status(upstream.statusCode || 200);
  for (const [key, value] of Object.entries(upstream.headers)) {
    if (value === undefined) continue;
    if (FORWARD_RES_HEADERS.has(key.toLowerCase())) {
      res.setHeader(key, value as string | string[]);
    }
  }

  const safeName = (filename || "file").replace(/[\r\n"]/g, "_");
  const disposition = forceDownload ? "attachment" : "inline";
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`
  );

  const onClientClose = () => {
    upstream.destroy();
  };
  req.on("close", onClientClose);

  upstream.on("error", (err) => {
    logger.warn({ err }, "Upstream stream error");
    try {
      res.end();
    } catch {
      // ignore
    }
  });

  upstream.pipe(res);
  upstream.on("end", () => {
    req.off("close", onClientClose);
  });
}
