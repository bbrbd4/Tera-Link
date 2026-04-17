import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/terabox", async (req, res) => {
  const url = req.query["url"];
  if (typeof url !== "string" || !url) {
    res.status(400).json({ success: false, error: "Missing url query parameter" });
    return;
  }

  try {
    const apiUrl = `https://gold-newt-367030.hostingersite.com/tera.php?url=${encodeURIComponent(url)}`;
    const response = await fetch(apiUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TeraBoxDownloader/1.0)",
      },
    });

    if (!response.ok) {
      req.log.warn({ status: response.status }, "Upstream API returned non-OK status");
      res.status(502).json({
        success: false,
        error: `Upstream API responded with status ${response.status}`,
      });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch from upstream TeraBox API");
    res.status(502).json({
      success: false,
      error: "Failed to reach the upstream API. Please try again later.",
    });
  }
});

export default router;
