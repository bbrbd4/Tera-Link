import { logger } from "./logger";
import { fetchTeraboxInfo, type TeraboxFileData } from "./teraboxApi";

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

const activeBots = new Map<string, BotState>();
const MAX_ACTIVE_BOTS = 50;

interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; first_name?: string; username?: string };
    from?: { id: number; first_name?: string; username?: string };
    text?: string;
  };
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

function maskToken(token: string): string {
  if (token.length < 12) return "***";
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

export interface PublicBotInfo {
  username: string;
  firstName: string;
  startedAt: number;
  processed: number;
  errors: number;
  tokenMask: string;
}

export function getBotInfo(token: string): PublicBotInfo | null {
  const b = activeBots.get(token);
  if (!b) return null;
  return {
    username: b.username,
    firstName: b.firstName,
    startedAt: b.startedAt,
    processed: b.processed,
    errors: b.errors,
    tokenMask: maskToken(token),
  };
}

export function listBots(): PublicBotInfo[] {
  return Array.from(activeBots.values()).map((b) => ({
    username: b.username,
    firstName: b.firstName,
    startedAt: b.startedAt,
    processed: b.processed,
    errors: b.errors,
    tokenMask: maskToken(b.token),
  }));
}

export async function startBot(token: string): Promise<PublicBotInfo> {
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) {
    throw new Error("Invalid bot token format. It should look like 123456789:ABC-DEF...");
  }
  const existing = activeBots.get(token);
  if (existing) {
    return getBotInfo(token)!;
  }
  if (activeBots.size >= MAX_ACTIVE_BOTS) {
    throw new Error("Server bot capacity is full. Please try again later.");
  }

  const me = await tgCall<{ id: number; username: string; first_name: string }>(
    token,
    "getMe",
    undefined,
    10000,
  );
  if (!me.ok || !me.result) {
    throw new Error(me.description || "Invalid bot token");
  }

  // Drop any pending updates to start fresh
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
  activeBots.set(token, state);

  // Set bot commands so users see /start in Telegram
  tgCall(token, "setMyCommands", {
    commands: [
      { command: "start", description: "Start the bot" },
      { command: "help", description: "How to use this bot" },
    ],
  }).catch(() => {
    // non-fatal
  });

  // Kick off polling loop
  pollLoop(state).catch((err) => {
    logger.error({ err, bot: state.username }, "Bot polling loop crashed");
    state.running = false;
    activeBots.delete(token);
  });

  logger.info({ bot: state.username }, "Bot started");
  return getBotInfo(token)!;
}

export function stopBot(token: string): boolean {
  const state = activeBots.get(token);
  if (!state) return false;
  state.running = false;
  activeBots.delete(token);
  logger.info({ bot: state.username }, "Bot stopped");
  return true;
}

async function pollLoop(state: BotState): Promise<void> {
  while (state.running && activeBots.get(state.token) === state) {
    try {
      const updates = await tgCall<TgUpdate[]>(
        state.token,
        "getUpdates",
        { offset: state.offset, timeout: 25, allowed_updates: ["message"] },
      );
      if (!updates.ok) {
        if (updates.error_code === 401) {
          logger.warn({ bot: state.username }, "Bot token is no longer valid, stopping");
          activeBots.delete(state.token);
          state.running = false;
          break;
        }
        await sleep(3000);
        continue;
      }
      const result = updates.result || [];
      for (const update of result) {
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

async function handleUpdate(state: BotState, update: TgUpdate): Promise<void> {
  const msg = update.message;
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  if (text.startsWith("/start")) {
    await tgCall(state.token, "sendMessage", {
      chat_id: chatId,
      text:
        `👋 Welcome to the *TeraBox Downloader Bot*\\!\n\n` +
        `Just send me any TeraBox share link and I'll reply with direct download and stream links\\.\n\n` +
        `You can send multiple links at once \\(one per line\\)\\.`,
      parse_mode: "MarkdownV2",
    });
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
        `Supports: terabox\\.com, 1024terabox\\.com, mirrobox, nephobox and more\\.`,
      parse_mode: "MarkdownV2",
    });
    return;
  }

  const urls = extractTeraboxUrls(text);
  if (urls.length === 0) {
    await tgCall(state.token, "sendMessage", {
      chat_id: chatId,
      text: "❌ Please send a valid TeraBox share link.",
    });
    return;
  }

  // Send "processing" placeholder
  const placeholder = await tgCall<{ message_id: number }>(state.token, "sendMessage", {
    chat_id: chatId,
    text: urls.length === 1
      ? "⏳ Fetching your link..."
      : `⏳ Fetching ${urls.length} links...`,
  });

  let processedHere = 0;
  for (const url of urls) {
    try {
      const result = await fetchTeraboxInfo(url);
      const file = result.data[0];
      await sendFileResult(state.token, chatId, file);
      processedHere += 1;
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

  // Delete the placeholder
  if (placeholder.ok && placeholder.result) {
    tgCall(state.token, "deleteMessage", {
      chat_id: chatId,
      message_id: placeholder.result.message_id,
    }).catch(() => {});
  }
}

async function sendFileResult(
  token: string,
  chatId: number,
  file: TeraboxFileData,
): Promise<void> {
  const streamUrl = file.stream_final_url || file.new_stream_url || file.stream_url || "";
  const isVideo = /\.(mp4|mkv|mov|webm|m4v|avi)$/i.test(file.file_name) ||
    (file.extension && /^(mp4|mkv|mov|webm|m4v|avi)$/i.test(file.extension));

  // Telegram Bot API: sending media by URL only works reliably up to ~20MB.
  const TG_URL_VIDEO_LIMIT = 20 * 1024 * 1024;
  const sizeBytes = Number(file.file_size_bytes) || 0;
  const canSendDirectly =
    isVideo &&
    !!file.download_url &&
    sizeBytes > 0 &&
    sizeBytes <= TG_URL_VIDEO_LIMIT;

  const baseCaption =
    `📁 *${escapeMdV2(file.file_name)}*\n` +
    `📦 Size: ${escapeMdV2(file.file_size || "")}` +
    (file.duration && file.duration !== "00:00"
      ? `\n⏱ Duration: ${escapeMdV2(file.duration)}`
      : "");

  // 1) Try to send the actual video for small files
  if (canSendDirectly) {
    const video = await tgCall(token, "sendVideo", {
      chat_id: chatId,
      video: file.download_url,
      caption: baseCaption,
      parse_mode: "MarkdownV2",
      supports_streaming: true,
    });
    if (video.ok) return;
    // fall through to link-based reply
  }

  // 2) Otherwise (or on failure) reply with thumbnail + buttons
  const inlineKeyboard: { text: string; url: string }[][] = [];
  if (file.download_url) {
    inlineKeyboard.push([{ text: "⬇️ Download", url: file.download_url }]);
  }
  if (streamUrl) {
    inlineKeyboard.push([{ text: "▶️ Stream Online", url: streamUrl }]);
  }
  if (file.share_url) {
    inlineKeyboard.push([{ text: "🔗 Share Page", url: file.share_url }]);
  }
  const replyMarkup = inlineKeyboard.length > 0
    ? { inline_keyboard: inlineKeyboard }
    : undefined;

  const tooLargeNote =
    isVideo && sizeBytes > TG_URL_VIDEO_LIMIT
      ? `\n\n_File is larger than 20MB \\- Telegram bots can't send it directly\\. Use the buttons below\\._`
      : "";
  const caption = baseCaption + tooLargeNote;

  if (file.thumbnail) {
    const photo = await tgCall(token, "sendPhoto", {
      chat_id: chatId,
      photo: file.thumbnail,
      caption,
      parse_mode: "MarkdownV2",
      reply_markup: replyMarkup,
    });
    if (photo.ok) return;
  }

  await tgCall(token, "sendMessage", {
    chat_id: chatId,
    text: caption,
    parse_mode: "MarkdownV2",
    disable_web_page_preview: true,
    reply_markup: replyMarkup,
  });
}
