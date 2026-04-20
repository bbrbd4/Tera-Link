import { Router, type IRouter } from "express";
import { fetchTeraboxInfo } from "../lib/teraboxApi";

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
    req.log.error({ err }, "Failed to fetch from upstream TeraBox API");
    const msg = err instanceof Error ? err.message : "Failed to reach the upstream API.";
    const code = (err as { code?: string }).code;
    const status = code === "LINK_INVALID" ? 404 : 502;
    res.status(status).json({ success: false, error: msg });
  }
});

export default router;
