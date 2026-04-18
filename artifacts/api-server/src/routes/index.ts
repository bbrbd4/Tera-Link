import { Router, type IRouter } from "express";
import healthRouter from "./health";
import teraboxRouter from "./terabox";
import botRouter from "./bot";

const router: IRouter = Router();

router.use(healthRouter);
router.use(teraboxRouter);
router.use(botRouter);

export default router;
