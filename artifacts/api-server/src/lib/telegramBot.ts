import { db, botUsersTable, botReferralsTable, type BotUser } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import { fetchTeraboxInfo, type TeraboxFileData } from "./teraboxApi";
import { fetchTeraboxFolderTree, type TeraboxTreeNode } from "./teraboxFolderApi";

const FREE_LINK_LIMIT = 1;
const PREMIUM_LINK_LIMIT = 10;
const FREE_FOLDER_FILE_LIMIT = 1;
const PREMIUM_FOLDER_FILE_LIMIT = 25;
const REFERRALS_FOR_PREMIUM = 3;
const PREMIUM_DAYS_PER_REWARD = 7;

interface BotState {
  token: string;
  username: string;
  firstName: string;
  offset: number;
  running: boolean;
  startedAt: number;
  processed: number;
  errors: number;
}

let activeBot: BotState | null = null;

interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; first_name?: string; username?: string };
    from?: { id: number; first_name?: string; username?: string; is_bot?: boolean };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name?: string; username?: string; is_bot?: boolean };
    message?: { message_id: number; chat: { id: number } };
    data?: string;
  };
}

// Telegram Bot API limits for sending uploaded files
const TG_UPLOAD_VIDEO_LIMIT = 50 * 1024 * 1024; // 50 MB
const TG_URL_VIDEO_LIMIT = 20 * 1024 * 1024; // 20 MB
const DOWNLOAD_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
interface PendingDownload {
  url: string;
  fileName: string;
  sizeBytes: number;
  duration?: string;
  isVideo: boolean;
  chatId: number;
  createdAt: number;
}
const pendingDownloads = new Map<string, PendingDownload>();
function makeDlToken(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
function reapPendingDownloads(): void {
  const cutoff = Date.now() - DOWNLOAD_TOKEN_TTL_MS;
  for (const [k, v] of pendingDownloads) {
    if (v.createdAt < cutoff) pendingDownloads.delete(k);
  }
}

interface TgResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

async function tgCall<T = unknown>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
  timeoutMs = 35000,
): Promise<TgResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    return (await res.json()) as TgResponse<T>;
  } finally {
    clearTimeout(timer);
  }
}

function escapeMdV2(text: string): string {
  return text.replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

// Inside MarkdownV2 code spans (`...`) only ` and \ need escaping.
function escapeMdV2Code(text: string): string {
  return text.replace(/[`\\]/g, (c) => `\\${c}`);
}

export interface PublicBotInfo {
  username: string;
  firstName: string;
  startedAt: number;
  processed: number;
  errors: number;
}

export function getOwnerBotInfo(): PublicBotInfo | null {
  if (!activeBot) return null;
  return {
    username: activeBot.username,
    firstName: activeBot.firstName,
    startedAt: activeBot.startedAt,
    processed: activeBot.processed,
    errors: activeBot.errors,
  };
}

export async function startOwnerBot(): Promise<PublicBotInfo | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    logger.warn("TELEGRAM_BOT_TOKEN is not set — Telegram bot disabled");
    return null;
  }
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) {
    logger.warn("TELEGRAM_BOT_TOKEN looks malformed — Telegram bot disabled");
    return null;
  }
  if (activeBot && activeBot.token === token) {
    return getOwnerBotInfo();
  }
  if (activeBot) {
    activeBot.running = false;
    activeBot = null;
  }

  const me = await tgCall<{ id: number; username: string; first_name: string }>(
    token,
    "getMe",
    undefined,
    10000,
  );
  if (!me.ok || !me.result) {
    logger.error({ err: me.description }, "TELEGRAM_BOT_TOKEN rejected by Telegram");
    return null;
  }

  try {
    await tgCall(token, "getUpdates", { offset: -1, timeout: 0 }, 10000);
  } catch {
    // ignore
  }

  const state: BotState = {
    token,
    username: me.result.username,
    firstName: me.result.first_name,
    offset: 0,
    running: true,
    startedAt: Date.now(),
    processed: 0,
    errors: 0,
  };
  activeBot = state;

  tgCall(token, "setMyCommands", {
    commands: [
      { command: "start", description: "Start the bot" },
      { command: "refer", description: "Get your referral link" },
      { command: "me", description: "Your account & premium status" },
      { command: "help", description: "How to use this bot" },
    ],
  }).catch(() => {
    // non-fatal
  });

  pollLoop(state).catch((err) => {
    logger.error({ err, bot: state.username }, "Bot polling loop crashed");
    state.running = false;
    if (activeBot === state) activeBot = null;
  });

  logger.info({ bot: state.username }, "Owner bot started");
  return getOwnerBotInfo();
}

async function pollLoop(state: BotState): Promise<void> {
  while (state.running && activeBot === state) {
    try {
      const updates = await tgCall<TgUpdate[]>(state.token, "getUpdates", {
        offset: state.offset,
        timeout: 25,
        allowed_updates: ["message", "callback_query"],
      });
      if (!updates.ok) {
        if (updates.error_code === 401) {
          logger.warn({ bot: state.username }, "Bot token rejected, stopping");
          state.running = false;
          if (activeBot === state) activeBot = null;
          break;
        }
        await sleep(3000);
        continue;
      }
      for (const update of updates.result || []) {
        state.offset = update.update_id + 1;
        handleUpdate(state, update).catch((err) => {
          state.errors += 1;
          logger.error({ err, bot: state.username }, "Failed to handle update");
        });
      }
    } catch (err) {
      logger.error({ err, bot: state.username }, "Poll error");
      await sleep(3000);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const URL_REGEX = /https?:\/\/[^\s<>"]+/gi;

function extractTeraboxUrls(text: string): string[] {
  const matches = text.match(URL_REGEX) || [];
  return matches.filter((u) =>
    /terabox|1024terabox|mirrobox|teraboxshare|nephobox|momerybox|tibibox|4funbox/i.test(u),
  );
}

function isPremium(user: BotUser): boolean {
  return !!user.premiumUntil && user.premiumUntil.getTime() > Date.now();
}

function makeReferralCode(telegramId: number): string {
  return Math.abs(telegramId).toString(36);
}

async function getOrCreateUser(
  telegramId: number,
  username: string | undefined,
  firstName: string | undefined,
): Promise<{ user: BotUser; isNew: boolean }> {
  const existing = await db
    .select()
    .from(botUsersTable)
    .where(eq(botUsersTable.telegramId, telegramId))
    .limit(1);
  if (existing[0]) {
    // Update last seen + names if changed
    const u = existing[0];
    if (u.username !== (username ?? null) || u.firstName !== (firstName ?? null)) {
      await db
        .update(botUsersTable)
        .set({
          username: username ?? null,
          firstName: firstName ?? null,
          lastSeenAt: new Date(),
        })
        .where(eq(botUsersTable.telegramId, telegramId));
    } else {
      await db
        .update(botUsersTable)
        .set({ lastSeenAt: new Date() })
        .where(eq(botUsersTable.telegramId, telegramId));
    }
    return { user: u, isNew: false };
  }
  const inserted = await db
    .insert(botUsersTable)
    .values({
      telegramId,
      username: username ?? null,
      firstName: firstName ?? null,
      referralCode: makeReferralCode(telegramId),
    })
    .returning();
  return { user: inserted[0]!, isNew: true };
}

async function applyReferral(
  newUserId: number,
  referralCode: string,
): Promise<BotUser | null> {
  const referrers = await db
    .select()
    .from(botUsersTable)
    .where(eq(botUsersTable.referralCode, referralCode))
    .limit(1);
  const referrer = referrers[0];
  if (!referrer || referrer.telegramId === newUserId) return null;

  // Insert referral edge — primary key on referredId prevents double credit
  try {
    await db.insert(botReferralsTable).values({
      referrerId: referrer.telegramId,
      referredId: newUserId,
    });
  } catch {
    return null; // already credited
  }

  // Mark new user as referred
  await db
    .update(botUsersTable)
    .set({ referredBy: referrer.telegramId })
    .where(eq(botUsersTable.telegramId, newUserId));

  // Atomically: increment referral_count, and if (count+1) % N == 0 grant
  // PREMIUM_DAYS_PER_REWARD days extending the later of NOW() and premium_until.
  const [updatedReferrer] = await db
    .update(botUsersTable)
    .set({
      referralCount: sql`${botUsersTable.referralCount} + 1`,
      premiumUntil: sql`CASE
        WHEN ((${botUsersTable.referralCount} + 1) % ${REFERRALS_FOR_PREMIUM}) = 0
        THEN GREATEST(COALESCE(${botUsersTable.premiumUntil}, NOW()), NOW())
             + make_interval(days => ${PREMIUM_DAYS_PER_REWARD})
        ELSE ${botUsersTable.premiumUntil}
      END`,
    })
    .where(eq(botUsersTable.telegramId, referrer.telegramId))
    .returning();
  return updatedReferrer ?? null;
}

function buildWelcome(firstName: string, botUsername: string): string {
  const safeName = escapeMdV2(firstName || "Friend");
  void botUsername;
  return (
    `𝑾𝒆𝒍𝒄𝒐𝒎𝒆, ${safeName}\\.\n` +
    `🌟 𝑰 𝒂𝒎 𝒂 𝑻𝒆𝒓𝒂𝑩𝒐𝒙 𝑳𝒊𝒏𝒌 𝒕𝒐 𝑽𝒊𝒅𝒆𝒐 𝑫𝒐𝒘𝒏𝒍𝒐𝒂𝒅𝒆𝒓 𝑩𝒐𝒕\\.\n` +
    `𝑺𝒆𝒏𝒅 𝒎𝒆 𝒂𝒏ʏ 𝑻𝒆𝒓𝒂𝑩𝒐𝒙 𝒍𝒊𝒏𝒌 𝒂𝒏𝒅 𝑰 𝒘𝒊𝒍𝒍 𝒅𝒐𝒘𝒏𝒍𝒐𝒂𝒅 𝒊𝒕 𝒘𝒊𝒕𝒉𝒊𝒏 𝒂 𝒇𝒆𝒘 𝒔𝒆𝒄𝒐𝒏𝒅𝒔 𝒂𝒏𝒅 𝒔𝒆𝒏𝒅 𝒊𝒕 𝒕𝒐 𝒚𝒐𝒖\\.✨\n\n` +
    `𝑹𝒆𝒇𝒆𝒓 𝒚𝒐𝒖𝒓 𝑭𝒓𝒊𝒆𝒏𝒅 𝒂𝒏𝒅 𝑮𝒆𝒕 𝑷𝒓𝒆𝒎𝒊𝒖𝒎 𝑷𝒍𝒂𝒏 Free\n` +
    `𝒈𝒊𝒗𝒆 » /refer`
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildReferText(user: BotUser, botUsername: string): string {
  const link = `https://t.me/${botUsername}?start=${user.referralCode}`;
  const premium = isPremium(user);
  const remaining =
    REFERRALS_FOR_PREMIUM - (user.referralCount % REFERRALS_FOR_PREMIUM);
  const expiry = user.premiumUntil
    ? user.premiumUntil.toISOString().slice(0, 10)
    : null;
  return (
    `🎁 <b>Refer &amp; Get Premium</b>\n\n` +
    `Share your link. Every <b>${REFERRALS_FOR_PREMIUM}</b> friends who join with it = <b>${PREMIUM_DAYS_PER_REWARD} days</b> of Premium.\n\n` +
    `🔗 Your link:\n<code>${escapeHtml(link)}</code>\n\n` +
    `👥 Total referrals: <b>${user.referralCount}</b>\n` +
    `⏭ Next reward in: <b>${remaining}</b> more friend${remaining === 1 ? "" : "s"}\n` +
    `${premium ? `💎 Premium active until <b>${escapeHtml(expiry || "")}</b>` : `🆓 Status: Free user`}`
  );
}

function buildMeText(user: BotUser): string {
  const premium = isPremium(user);
  const expiry = user.premiumUntil
    ? user.premiumUntil.toISOString().slice(0, 10)
    : null;
  return (
    `👤 <b>Your Account</b>\n\n` +
    `🆔 ID: <code>${user.telegramId}</code>\n` +
    `👥 Referrals: <b>${user.referralCount}</b>\n` +
    `${premium ? `💎 <b>Premium</b> until ${escapeHtml(expiry || "")}` : `🆓 Free user`}\n\n` +
    (premium
      ? `✨ You can send up to <b>${PREMIUM_LINK_LIMIT}</b> links per message and open full folders.`
      : `Free users: <b>${FREE_LINK_LIMIT}</b> link per message, <b>${FREE_FOLDER_FILE_LIMIT}</b> file from a folder. Use /refer to upgrade.`)
  );
}

async function handleUpdate(state: BotState, update: TgUpdate): Promise<void> {
  if (update.callback_query) {
    await handleCallbackQuery(state, update.callback_query);
    return;
  }
  const msg = update.message;
  if (!msg || !msg.text || !msg.from || msg.from.is_bot) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const fromId = msg.from.id;

  const { user, isNew } = await getOrCreateUser(
    fromId,
    msg.from.username,
    msg.from.first_name,
  );

  // /start [referral_code]
  if (text.startsWith("/start")) {
    const parts = text.split(/\s+/);
    const refCode = parts[1]?.trim();
    if (isNew && refCode && refCode !== user.referralCode) {
      const referrer = await applyReferral(fromId, refCode);
      if (referrer) {
        // Notify the referrer
        tgCall(state.token, "sendMessage", {
          chat_id: referrer.telegramId,
          text:
            `🎉 New referral\\! You now have *${referrer.referralCount}* total\\.` +
            (isPremium(referrer)
              ? `\n💎 Premium active until *${escapeMdV2(referrer.premiumUntil!.toISOString().slice(0, 10))}*`
              : ``),
          parse_mode: "MarkdownV2",
        }).catch(() => {});
      }
    }
    await tgCall(state.token, "sendMessage", {
      chat_id: chatId,
      text: buildWelcome(msg.from.first_name || "Friend", state.username),
      parse_mode: "MarkdownV2",
    });
    return;
  }

  if (text.startsWith("/refer")) {
    const r = await tgCall(state.token, "sendMessage", {
      chat_id: chatId,
      text: buildReferText(user, state.username),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    if (!r.ok) logger.error({ desc: r.description }, "refer send failed");
    return;
  }

  if (text.startsWith("/me")) {
    const r = await tgCall(state.token, "sendMessage", {
      chat_id: chatId,
      text: buildMeText(user),
      parse_mode: "HTML",
    });
    if (!r.ok) logger.error({ desc: r.description }, "me send failed");
    return;
  }

  if (text.startsWith("/help")) {
    await tgCall(state.token, "sendMessage", {
      chat_id: chatId,
      text:
        `📘 *How to use*\n\n` +
        `1\\. Copy a TeraBox share link\n` +
        `2\\. Send it to this chat\n` +
        `3\\. Tap *Download* or *Stream* in the reply\n\n` +
        `Free users: *${FREE_LINK_LIMIT}* link/message, *${FREE_FOLDER_FILE_LIMIT}* file from folders\\.\n` +
        `Premium: up to *${PREMIUM_LINK_LIMIT}* links/message and full folders\\.\n\n` +
        `Use /refer to earn Premium for free\\.`,
      parse_mode: "MarkdownV2",
    });
    return;
  }

  let urls = extractTeraboxUrls(text);
  if (urls.length === 0) {
    await tgCall(state.token, "sendMessage", {
      chat_id: chatId,
      text: "❌ Please send a valid TeraBox share link.",
    });
    return;
  }

  const premium = isPremium(user);
  const linkLimit = premium ? PREMIUM_LINK_LIMIT : FREE_LINK_LIMIT;
  const folderLimit = premium ? PREMIUM_FOLDER_FILE_LIMIT : FREE_FOLDER_FILE_LIMIT;

  if (urls.length > linkLimit) {
    const skipped = urls.length - linkLimit;
    urls = urls.slice(0, linkLimit);
    await tgCall(state.token, "sendMessage", {
      chat_id: chatId,
      text: premium
        ? `ℹ️ Processing the first ${linkLimit} links \\(${skipped} skipped\\)\\.`
        : `🔒 *Free users:* only *${FREE_LINK_LIMIT}* link per message\\. Skipped ${skipped}\\.\nUse /refer to unlock up to *${PREMIUM_LINK_LIMIT}* links\\.`,
      parse_mode: "MarkdownV2",
    }).catch(() => {});
  }

  const placeholder = await tgCall<{ message_id: number }>(state.token, "sendMessage", {
    chat_id: chatId,
    text: urls.length === 1
      ? "⏳ Fetching your link..."
      : `⏳ Fetching ${urls.length} links...`,
  });

  let processedHere = 0;
  for (const url of urls) {
    try {
      let filesInLink: TeraboxFileData[] = [];
      try {
        const result = await fetchTeraboxInfo(url);
        filesInLink = result.data || [];
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code !== "LINK_INVALID") throw err;
        // Nested folder fallback
        const tree = await fetchTeraboxFolderTree(url);
        if (!premium) {
          await tgCall(state.token, "sendMessage", {
            chat_id: chatId,
            text:
              `📂 *Nested folder detected* \\- ${tree.totalFiles} files\n` +
              `🔒 Free users can only see folder listings\\. Use /refer to unlock full access\\.`,
            parse_mode: "MarkdownV2",
          }).catch(() => {});
        } else {
          await tgCall(state.token, "sendMessage", {
            chat_id: chatId,
            text:
              `📂 *Nested folder* \\- ${tree.totalFiles} files in ${tree.totalFolders} subfolders \\(${escapeMdV2(tree.totalSizeText)}\\)`,
            parse_mode: "MarkdownV2",
          }).catch(() => {});
        }
        await sendFolderTreeListing(state.token, chatId, tree.root, folderLimit);
        processedHere += tree.totalFiles;
        continue;
      }

      if (filesInLink.length === 0) {
        throw new Error("No files found in this link.");
      }

      if (filesInLink.length > 1) {
        await tgCall(state.token, "sendMessage", {
          chat_id: chatId,
          text:
            `📂 *Folder detected* \\- ${filesInLink.length} files\n` +
            (premium
              ? `Sending up to ${folderLimit} files\\.\\.\\.`
              : `🔒 *Free users:* only *${FREE_FOLDER_FILE_LIMIT}* file from each folder\\. Use /refer for full folder access\\.`),
          parse_mode: "MarkdownV2",
        }).catch(() => {});
      }

      const toSend = filesInLink.slice(0, folderLimit);
      for (const file of toSend) {
        try {
          await sendFileResult(state.token, chatId, file);
          processedHere += 1;
        } catch (err) {
          state.errors += 1;
          logger.error({ err, bot: state.username }, "Failed to send a file");
        }
      }
      if (filesInLink.length > folderLimit && premium) {
        await tgCall(state.token, "sendMessage", {
          chat_id: chatId,
          text: `ℹ️ Folder has ${filesInLink.length} files. Showing the first ${folderLimit}. Open the original link for the rest.`,
          disable_web_page_preview: true,
        }).catch(() => {});
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      await tgCall(state.token, "sendMessage", {
        chat_id: chatId,
        text: `❌ Failed to fetch this link:\n${url}\n\n${errMsg}`,
        disable_web_page_preview: true,
      }).catch(() => {});
      state.errors += 1;
    }
  }
  state.processed += processedHere;

  if (placeholder.ok && placeholder.result) {
    tgCall(state.token, "deleteMessage", {
      chat_id: chatId,
      message_id: placeholder.result.message_id,
    }).catch(() => {});
  }

  // Bump processed-count metric on user
  if (processedHere > 0) {
    db.update(botUsersTable)
      .set({ lastSeenAt: new Date() })
      .where(eq(botUsersTable.telegramId, fromId))
      .catch(() => {});
  }
}

async function sendFolderTreeListing(
  token: string,
  chatId: number,
  root: TeraboxTreeNode,
  maxFiles: number,
): Promise<void> {
  const collected: { folder: string; node: TeraboxTreeNode }[] = [];
  const walk = (n: TeraboxTreeNode, parentPath: string): void => {
    if (collected.length >= maxFiles) return;
    if (n.isDir) {
      const here = parentPath ? `${parentPath}/${n.name}` : n.name;
      for (const c of n.children || []) walk(c, here);
    } else {
      collected.push({ folder: parentPath || "/", node: n });
    }
  };
  for (const c of root.children || []) walk(c, "");

  const groups = new Map<string, TeraboxTreeNode[]>();
  for (const item of collected) {
    if (!groups.has(item.folder)) groups.set(item.folder, []);
    groups.get(item.folder)!.push(item.node);
  }

  for (const [folder, files] of groups) {
    const header = `📁 *${escapeMdV2(folder)}* \\(${files.length} files\\)\n\n`;
    const lines = files.slice(0, 30).map((f) => {
      const teraboxUrl = `https://1024terabox.com/sharing/link?surl=${f.shorturl}&path=${encodeURIComponent(f.path)}`;
      return `• [${escapeMdV2(f.name)}](${teraboxUrl}) \\- ${escapeMdV2(f.sizeText)}`;
    });
    const text =
      header +
      lines.join("\n") +
      (files.length > 30 ? `\n\n_\\.\\.\\.and ${files.length - 30} more_` : "");
    await tgCall(token, "sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "MarkdownV2",
      disable_web_page_preview: true,
    }).catch(() => {});
  }

  if (collected.length >= maxFiles) {
    await tgCall(token, "sendMessage", {
      chat_id: chatId,
      text: `ℹ️ Showing the first ${maxFiles} files only.`,
    }).catch(() => {});
  }
}

async function sendFileResult(
  token: string,
  chatId: number,
  file: TeraboxFileData,
): Promise<void> {
  const streamUrl = file.stream_final_url || file.new_stream_url || file.stream_url || "";
  const VIDEO_EXT_RE = /^(mp4|mkv|mov|webm|m4v|avi|3gp|flv|ts|mpg|mpeg|wmv)$/i;
  const isVideo = Boolean(
    /\.(mp4|mkv|mov|webm|m4v|avi|3gp|flv|ts|mpg|mpeg|wmv)$/i.test(file.file_name) ||
      (file.extension && VIDEO_EXT_RE.test(file.extension)) ||
      // Fallback: TeraBox shares are nearly always videos when a duration is present
      (file.duration && file.duration !== "00:00"),
  );

  const sizeBytes = Number(file.file_size_bytes) || 0;
  const canSendDirectly =
    isVideo && !!file.download_url && sizeBytes > 0 && sizeBytes <= TG_URL_VIDEO_LIMIT;

  const baseCaption =
    `📁 <b>${escapeHtml(file.file_name)}</b>\n` +
    `📦 Size: ${escapeHtml(file.file_size || "")}` +
    (file.duration && file.duration !== "00:00"
      ? `\n⏱ Duration: ${escapeHtml(file.duration)}`
      : "");

  if (canSendDirectly) {
    const video = await tgCall(token, "sendVideo", {
      chat_id: chatId,
      video: file.download_url,
      caption: baseCaption,
      parse_mode: "HTML",
      supports_streaming: true,
    });
    if (video.ok) return;
  }

  // For larger files: show Download button as a callback. When pressed, the
  // bot fetches the file server-side and uploads it directly to Telegram —
  // no download URL is ever exposed to the user.
  reapPendingDownloads();
  const inlineKeyboard: { text: string; url?: string; callback_data?: string }[][] = [];
  if (file.download_url) {
    const tooLarge = sizeBytes > 0 && sizeBytes > TG_UPLOAD_VIDEO_LIMIT;
    if (tooLarge) {
      inlineKeyboard.push([{ text: "⚠️ File too large for Telegram (max 50MB)", callback_data: "noop" }]);
    } else {
      const tok = makeDlToken();
      pendingDownloads.set(tok, {
        url: file.download_url,
        fileName: file.file_name,
        sizeBytes,
        duration: file.duration,
        isVideo: !!isVideo,
        chatId,
        createdAt: Date.now(),
      });
      inlineKeyboard.push([{ text: "⬇️ Download", callback_data: `dl:${tok}` }]);
    }
  }
  if (streamUrl) inlineKeyboard.push([{ text: "▶️ Stream Online", url: streamUrl }]);
  const replyMarkup =
    inlineKeyboard.length > 0 ? { inline_keyboard: inlineKeyboard } : undefined;

  const sizeNote =
    isVideo && sizeBytes > TG_URL_VIDEO_LIMIT && sizeBytes <= TG_UPLOAD_VIDEO_LIMIT
      ? `\n\n<i>Tap Download — I'll upload it here directly.</i>`
      : "";
  const caption = baseCaption + sizeNote;

  if (file.thumbnail) {
    const photo = await tgCall(token, "sendPhoto", {
      chat_id: chatId,
      photo: file.thumbnail,
      caption,
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    });
    if (photo.ok) return;
  }

  await tgCall(token, "sendMessage", {
    chat_id: chatId,
    text: caption,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: replyMarkup,
  });
}

async function tgUploadMultipart(
  token: string,
  method: "sendVideo" | "sendDocument",
  fields: Record<string, string>,
  fileField: string,
  fileName: string,
  fileBlob: Blob,
): Promise<TgResponse<unknown>> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append(fileField, fileBlob, fileName);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5 * 60 * 1000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    return (await res.json()) as TgResponse<unknown>;
  } finally {
    clearTimeout(timer);
  }
}

async function handleCallbackQuery(
  state: BotState,
  cq: NonNullable<TgUpdate["callback_query"]>,
): Promise<void> {
  const data = cq.data || "";
  const chatId = cq.message?.chat.id;
  const ackOnly = async (text?: string) =>
    tgCall(state.token, "answerCallbackQuery", {
      callback_query_id: cq.id,
      text,
      show_alert: false,
    }).catch(() => {});

  if (data === "noop" || !chatId) {
    await ackOnly();
    return;
  }
  if (!data.startsWith("dl:")) {
    await ackOnly();
    return;
  }
  const tok = data.slice(3);
  const pd = pendingDownloads.get(tok);
  if (!pd) {
    await ackOnly("Link expired. Please send the TeraBox link again.");
    return;
  }
  pendingDownloads.delete(tok);
  await ackOnly("⏳ Downloading… please wait");

  const status = await tgCall<{ message_id: number }>(state.token, "sendMessage", {
    chat_id: chatId,
    text: `⏳ Downloading <b>${escapeHtml(pd.fileName)}</b>…`,
    parse_mode: "HTML",
  });
  const statusMsgId = status.ok && status.result ? status.result.message_id : null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4 * 60 * 1000);
    let buf: Buffer;
    try {
      const res = await fetch(pd.url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
          Referer: "https://www.terabox.com/",
          Accept: "*/*",
          "Accept-Encoding": "identity",
        },
      });
      if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
      const contentLen = Number(res.headers.get("content-length") || "0");
      if (contentLen > TG_UPLOAD_VIDEO_LIMIT) {
        throw new Error("File too large for Telegram (50MB limit).");
      }
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.startsWith("video/")) pd.isVideo = true;
      const ab = await res.arrayBuffer();
      if (ab.byteLength > TG_UPLOAD_VIDEO_LIMIT) {
        throw new Error("File too large for Telegram (50MB limit).");
      }
      buf = Buffer.from(ab);
    } finally {
      clearTimeout(timer);
    }

    const caption =
      `📁 <b>${escapeHtml(pd.fileName)}</b>\n📦 Size: ${escapeHtml(formatBytes(buf.length))}` +
      (pd.duration && pd.duration !== "00:00" ? `\n⏱ Duration: ${escapeHtml(pd.duration)}` : "");
    const blob = new Blob([new Uint8Array(buf)]);
    const method = pd.isVideo ? "sendVideo" : "sendDocument";
    const fileField = pd.isVideo ? "video" : "document";
    const fields: Record<string, string> = {
      chat_id: String(chatId),
      caption,
      parse_mode: "HTML",
    };
    if (pd.isVideo) fields.supports_streaming = "true";
    const result = await tgUploadMultipart(state.token, method, fields, fileField, pd.fileName, blob);
    if (!result.ok) throw new Error(result.description || "upload failed");
    if (statusMsgId) {
      tgCall(state.token, "deleteMessage", {
        chat_id: chatId,
        message_id: statusMsgId,
      }).catch(() => {});
    }
  } catch (err) {
    logger.error({ err, file: pd.fileName }, "callback download failed");
    const errText = err instanceof Error ? err.message : "unknown error";
    if (statusMsgId) {
      tgCall(state.token, "editMessageText", {
        chat_id: chatId,
        message_id: statusMsgId,
        text: `❌ Could not upload <b>${escapeHtml(pd.fileName)}</b>: ${escapeHtml(errText)}`,
        parse_mode: "HTML",
      }).catch(() => {});
    } else {
      tgCall(state.token, "sendMessage", {
        chat_id: chatId,
        text: `❌ Could not upload <b>${escapeHtml(pd.fileName)}</b>: ${escapeHtml(errText)}`,
        parse_mode: "HTML",
      }).catch(() => {});
    }
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
