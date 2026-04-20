import { Router, type IRouter } from "express";
import { fetchTeraboxInfo } from "../lib/teraboxApi";
import { fetchTeraboxFolderTree } from "../lib/teraboxFolderApi";
import { extractTeraboxDlink } from "../lib/teraboxDlink";

const router: IRouter = Router();

router.get("/terabox", async (req, res) => {
  const url = req.query["url"];
  if (typeof url !== "string" || !url) {
    res.status(400).json({ success: false, error: "Missing url query parameter" });
    return;
  }
  try {
    const data = await fetchTeraboxInfo(url);
    res.json(data);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "LINK_INVALID") {
      try {
        const tree = await fetchTeraboxFolderTree(url);
        res.json({ success: true, kind: "folder-tree", tree });
        return;
      } catch (treeErr) {
        req.log.warn({ err: treeErr }, "Folder tree fallback also failed");
      }
    }
    req.log.error({ err }, "Failed to fetch from upstream TeraBox API");
    const msg = err instanceof Error ? err.message : "Failed to reach the upstream API.";
    const status = code === "LINK_INVALID" ? 404 : 502;
    res.status(status).json({ success: false, error: msg });
  }
});

router.get("/terabox/folder", async (req, res) => {
  const url = req.query["url"];
  if (typeof url !== "string" || !url) {
    res.status(400).json({ success: false, error: "Missing url query parameter" });
    return;
  }
  try {
    const tree = await fetchTeraboxFolderTree(url);
    res.json({ success: true, tree });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch TeraBox folder tree");
    const msg = err instanceof Error ? err.message : "Failed to fetch folder";
    res.status(404).json({ success: false, error: msg });
  }
});

router.get("/terabox/dlink", async (req, res) => {
  const surl = req.query["surl"];
  const dir = req.query["dir"];
  const fsId = req.query["fsId"];
  if (typeof surl !== "string" || !surl) {
    res.status(400).json({ success: false, error: "Missing surl" });
    return;
  }
  if (typeof dir !== "string" || !dir) {
    res.status(400).json({ success: false, error: "Missing dir" });
    return;
  }
  if (typeof fsId !== "string" || !fsId) {
    res.status(400).json({ success: false, error: "Missing fsId" });
    return;
  }
  try {
    const result = await extractTeraboxDlink(surl, dir, fsId);
    res.json({ success: true, ...result });
  } catch (err) {
    req.log.error({ err, surl, dir, fsId }, "Failed to extract dlink");
    const rawMsg = err instanceof Error ? err.message : "";
    let clientMsg = "Could not generate a download link for this file.";
    if (/not configured/i.test(rawMsg)) {
      clientMsg = "Direct downloads are not available right now.";
    } else if (/not found/i.test(rawMsg)) {
      clientMsg = "File could not be found inside this share.";
    } else if (/timeout|timed out/i.test(rawMsg)) {
      clientMsg = "TeraBox took too long to respond. Please try again.";
    }
    res.status(502).json({ success: false, error: clientMsg });
  }
});

export default router;
