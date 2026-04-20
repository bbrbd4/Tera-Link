export interface TeraboxTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  sizeText: string;
  fsId?: string;
  category?: number;
  thumbnail?: string;
  shorturl: string;
  shareUrl: string;
  children?: TeraboxTreeNode[];
}

export interface TeraboxFolderResult {
  root: TeraboxTreeNode;
  totalFiles: number;
  totalFolders: number;
  totalSize: number;
  totalSizeText: string;
}

const BASE_HOST = "https://www.terabox.com";
const MAX_DEPTH = 6;
const MAX_NODES = 500;

function extractShorturl(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    const params = u.searchParams;
    const surlParam = params.get("surl");
    if (surlParam) return surlParam;
    const m = u.pathname.match(/\/s\/([^/?#]+)/);
    if (m && m[1]) {
      return m[1].startsWith("1") ? m[1].slice(1) : m[1];
    }
  } catch {
    return null;
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

interface ListEntry {
  category: string | number;
  fs_id: string | number;
  isdir: string | number;
  path: string;
  server_filename: string;
  size: string | number;
  thumbs?: { url1?: string; url2?: string; url3?: string };
}

interface ListResponse {
  errno: number;
  list?: ListEntry[];
  title?: string;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36";

interface SessionCtx {
  cookieHeader: string;
  jsToken: string;
  referer: string;
}

const sessionCache = new Map<string, { ctx: SessionCtx; expiresAt: number }>();

async function getSession(shorturl: string): Promise<SessionCtx> {
  const cached = sessionCache.get(shorturl);
  if (cached && cached.expiresAt > Date.now()) return cached.ctx;

  const referer = `https://www.terabox.com/sharing/link?surl=${shorturl}`;
  const res = await fetch(referer, {
    headers: {
      "User-Agent": UA,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const cookies: Record<string, string> = {};
  for (const c of setCookies) {
    const part = c.split(";")[0];
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq > 0) cookies[part.slice(0, eq)] = part.slice(eq + 1);
  }
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

  const html = await res.text();
  const decoded = decodeURIComponent(html);
  const m = decoded.match(/fn\("([0-9A-F]{20,})"\)/);
  const jsToken = m ? m[1]! : "";

  const ctx: SessionCtx = { cookieHeader, jsToken, referer };
  sessionCache.set(shorturl, { ctx, expiresAt: Date.now() + 5 * 60 * 1000 });
  return ctx;
}

async function listDir(shorturl: string, dir: string, attempt = 0): Promise<ListEntry[]> {
  const session = await getSession(shorturl);
  const params = new URLSearchParams({
    app_id: "250528",
    web: "1",
    channel: "dubox",
    clienttype: "0",
    shorturl,
  });
  if (session.jsToken) params.set("jsToken", session.jsToken);
  if (dir === "/") params.set("root", "1");
  else params.set("dir", dir);

  const res = await fetch(`${BASE_HOST}/share/list?${params.toString()}`, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: session.referer,
      Cookie: session.cookieHeader,
    },
  });
  if (!res.ok) throw new Error(`share/list HTTP ${res.status}`);
  const json = (await res.json()) as ListResponse & { errmsg?: string };
  // Retry once with fresh session if upstream says verify needed
  if ((json.errno === 400141 || json.errno === -6) && attempt === 0) {
    sessionCache.delete(shorturl);
    return listDir(shorturl, dir, 1);
  }
  if (json.errno !== 0 || !json.list) return [];
  return json.list;
}

export async function fetchTeraboxFolderTree(rawUrl: string): Promise<TeraboxFolderResult> {
  const shorturl = extractShorturl(rawUrl);
  if (!shorturl) throw new Error("Could not extract shorturl from the link");

  const baseShareUrl = `https://1024terabox.com/s/1${shorturl}`;
  let totalFiles = 0;
  let totalFolders = 0;
  let totalSize = 0;
  let nodeCount = 0;

  const root: TeraboxTreeNode = {
    name: "Root",
    path: "/",
    isDir: true,
    size: 0,
    sizeText: "",
    shorturl,
    shareUrl: baseShareUrl,
    children: [],
  };

  async function walk(dir: string, parent: TeraboxTreeNode, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || nodeCount > MAX_NODES) return;
    let entries: ListEntry[];
    try {
      entries = await listDir(shorturl, dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (nodeCount > MAX_NODES) return;
      nodeCount++;
      const isDir = String(e.isdir) === "1";
      const sizeNum = Number(e.size) || 0;
      const node: TeraboxTreeNode = {
        name: e.server_filename || e.path.split("/").pop() || "Unknown",
        path: e.path,
        isDir,
        size: sizeNum,
        sizeText: isDir ? "" : formatBytes(sizeNum),
        fsId: String(e.fs_id),
        category: typeof e.category === "string" ? Number(e.category) : e.category,
        thumbnail: e.thumbs?.url3 || e.thumbs?.url2 || e.thumbs?.url1,
        shorturl,
        shareUrl: baseShareUrl,
      };
      if (isDir) {
        totalFolders++;
        node.children = [];
        parent.children!.push(node);
        await walk(e.path, node, depth + 1);
      } else {
        totalFiles++;
        totalSize += sizeNum;
        parent.children!.push(node);
      }
    }
  }

  await walk("/", root, 0);

  if (totalFiles === 0 && totalFolders === 0) {
    throw new Error(
      "This link is invalid, expired, private, or the file was deleted. Please check the link on TeraBox and try again."
    );
  }

  return {
    root,
    totalFiles,
    totalFolders,
    totalSize,
    totalSizeText: formatBytes(totalSize),
  };
}
