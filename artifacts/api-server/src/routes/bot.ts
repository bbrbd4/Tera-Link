import { Router, type IRouter } from "express";
import { startBot, stopBot, getBotInfo } from "../lib/telegramBot";

const router: IRouter = Router();

router.post("/bot/start", async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!token) {
    res.status(400).json({ success: false, error: "Missing bot token" });
    return;
  }
  try {
    const info = await startBot(token);
    res.json({ success: true, bot: info });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to start bot";
    req.log.warn({ err }, "startBot failed");
    res.status(400).json({ success: false, error: msg });
  }
});

router.post("/bot/stop", async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!token) {
    res.status(400).json({ success: false, error: "Missing bot token" });
    return;
  }
  const stopped = stopBot(token);
  res.json({ success: true, stopped });
});

router.post("/bot/status", async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!token) {
    res.status(400).json({ success: false, error: "Missing bot token" });
    return;
  }
  const info = getBotInfo(token);
  res.json({ success: true, running: !!info, bot: info });
});

export default router;
