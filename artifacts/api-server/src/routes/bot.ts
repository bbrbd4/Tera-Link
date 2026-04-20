import { Router, type IRouter } from "express";
import { getOwnerBotInfo } from "../lib/telegramBot";

const router: IRouter = Router();

router.get("/bot/status", (_req, res) => {
  const info = getOwnerBotInfo();
  res.json({ success: true, running: !!info, bot: info });
});

export default router;
