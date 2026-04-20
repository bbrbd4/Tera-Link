import { Router, type IRouter } from "express";
import { fetchTeraboxInfo } from "../lib/teraboxApi";
import { fetchTeraboxFolderTree } from "../lib/teraboxFolderApi";

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

export default router;
