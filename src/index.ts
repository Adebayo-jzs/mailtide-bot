import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";
import { createBot, sendJobNotification } from "./telegram";
import { createGmailClient, fetchJobEmails } from "./gmail";
import { startServer } from "./server";
import { initDb, getAllUsers, getUser, deleteUser, updateLastCheckTime, closePool } from "./db";
import http from "http";

// ─── Env validation ──────────────────────────────────────
const REQUIRED_ENV_VARS = [
  "TELEGRAM_BOT_TOKEN",
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_REDIRECT_URI",
  "DATABASE_URL",
  "ENCRYPTION_KEY",
] as const;

function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n  ${missing.join("\n  ")}\n\n` +
      `Copy .env.example to .env and fill in all values.`
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────

function isInvalidGrant(err: unknown): boolean {
  return err instanceof Error && err.message.includes("invalid_grant");
}

async function handleExpiredToken(bot: TelegramBot, chatId: number) {
  await deleteUser(chatId);
  notifiedIds.delete(chatId);
  await bot.sendMessage(
    chatId,
    "⚠️ Your Google access has expired or been revoked.\n\n" +
    "Please reconnect using /start"
  ).catch(() => {});
}

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS ?? "60000", 10);
const HOURS_48_MS = 48 * 60 * 60 * 1000;

// Track notified email IDs per user with timestamps for age-based eviction
const notifiedIds = new Map<number, Map<string, number>>();

function getUserNotified(chatId: number): Map<string, number> {
  if (!notifiedIds.has(chatId)) {
    notifiedIds.set(chatId, new Map());
  }
  return notifiedIds.get(chatId)!;
}

/** Remove notified IDs older than 48 hours to prevent unbounded memory growth */
function pruneNotifiedIds() {
  const cutoff = Date.now() - HOURS_48_MS;
  for (const [chatId, emailMap] of notifiedIds) {
    for (const [emailId, timestamp] of emailMap) {
      if (timestamp < cutoff) {
        emailMap.delete(emailId);
      }
    }
    // Clean up empty user entries
    if (emailMap.size === 0) {
      notifiedIds.delete(chatId);
    }
  }
}

/**
 * Check a single user's Gmail for job emails since a given timestamp.
 * Sends notifications for any new matches and returns the count.
 */
async function checkUserEmails(
  bot: TelegramBot,
  chatId: number,
  refreshToken: string,
  sinceTimestamp: number
): Promise<number> {
  const auth = createGmailClient(refreshToken);
  const emails = await fetchJobEmails(auth, sinceTimestamp);
  const userNotified = getUserNotified(chatId);

  const newEmails = emails.filter((e) => !userNotified.has(e.id));

  for (const email of newEmails) {
    await sendJobNotification(bot, chatId, email);
    userNotified.set(email.id, Date.now());
    console.log(`  [${email.category}] "${email.subject}" from ${email.from}`);
  }

  return newEmails.length;
}

async function main() {
  console.log("🤖 Multi-User Job Application Bot starting...");

  // Validate all required env vars before doing anything else
  validateEnv();

  await initDb();
  console.log("✅ Database initialized");

  const bot = createBot();

  // Register commands in Telegram's menu
  bot.setMyCommands([
    { command: "start", description: "Connect your Gmail account" },
    { command: "check", description: "Scan inbox for job emails (past 48h)" },
    { command: "status", description: "View your account status" },
    { command: "stop", description: "Disconnect your Gmail account" },
    { command: "help", description: "Show all available commands" },
  ]);

  // Notify all registered users that the bot is online
  const users = await getAllUsers();
  for (const user of users) {
    await bot.sendMessage(
      user.chat_id,
      "💼 Job Application Bot started!\n\nWatching your inbox for:\n✅ Application confirmations\n📅 Interview invitations\n🧪 Assessments\n🎉 Job offers\n❌ Rejections\n🔁 Follow-ups"
    ).catch((err) => console.error(`Failed to send startup msg to ${user.chat_id}:`, err));
  }

  // ─── /start ─────────────────────────────────────────────
  bot.onText(/^\/start/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const existing = await getUser(chatId);

      if (existing) {
        await bot.sendMessage(
          chatId,
          "You're already connected! ✅\n\nUse /check to scan your inbox or /help to see all commands."
        );
        return;
      }

      const authUrl = getAuthUrl(chatId);
      await bot.sendMessage(
        chatId,
        "Welcome to the Job Application Bot! 💼\n\n" +
        "Tap the button below to connect your Gmail account.\n\n" +
        "📌 If it opens in Telegram's browser, long-press the button and choose 'Open in external browser'.",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔐 Connect Gmail", url: authUrl }]
            ]
          }
        }
      );
    } catch (err) {
      console.error(`❌ /start error for ${chatId}:`, err);
    }
  });

  // ─── /check ─────────────────────────────────────────────
  bot.onText(/^\/check/, async (msg) => {
    const chatId = msg.chat.id;
    const user = await getUser(chatId);

    if (!user) {
      await bot.sendMessage(chatId, "❌ You're not connected yet. Use /start to sign in first.");
      return;
    }

    await bot.sendMessage(chatId, "🔍 Scanning your inbox for job emails from the past 48 hours...");

    try {
      const since = Date.now() - HOURS_48_MS;
      const count = await checkUserEmails(bot, chatId, user.refresh_token, since);

      if (count === 0) {
        await bot.sendMessage(chatId, "📭 No new job-related emails found in the past 48 hours.");
      } else {
        await bot.sendMessage(chatId, `✅ Done! Sent ${count} job-related email(s) above.`);
      }
    } catch (err) {
      if (isInvalidGrant(err)) {
        await handleExpiredToken(bot, chatId);
      } else {
        console.error(`❌ /check error for user ${chatId}:`, err);
        await bot.sendMessage(chatId, "❌ Something went wrong while checking your inbox. Please try again later.");
      }
    }
  });

  // ─── /status ────────────────────────────────────────────
  bot.onText(/^\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const user = await getUser(chatId);

    if (!user) {
      await bot.sendMessage(chatId, "❌ You're not connected. Use /start to sign in.");
      return;
    }

    const lastCheck = new Date(user.last_check_time).toISOString().replace("T", " ").slice(0, 19) + " UTC";
    const pollSec = POLL_INTERVAL / 1000;

    await bot.sendMessage(
      chatId,
      "📊 Account Status\n\n" +
      `✅ Gmail: Connected\n` +
      `🕐 Last checked: ${lastCheck}\n` +
      `⏱ Poll interval: every ${pollSec}s`
    );
  });

  // ─── /stop ──────────────────────────────────────────────
  bot.onText(/^\/stop/, async (msg) => {
    const chatId = msg.chat.id;
    const user = await getUser(chatId);

    if (!user) {
      await bot.sendMessage(chatId, "You don't have an active connection.");
      return;
    }

    await deleteUser(chatId);
    notifiedIds.delete(chatId);

    await bot.sendMessage(
      chatId,
      "🔌 Your Gmail account has been disconnected and your data has been removed.\n\nUse /start to reconnect anytime."
    );
  });

  // ─── /help ──────────────────────────────────────────────
  bot.onText(/^\/help/, async (msg) => {
    await bot.sendMessage(
      msg.chat.id,
      "💼 Job Application Bot — Commands\n\n" +
      "/start — Connect your Gmail account\n" +
      "/check — Scan inbox for job emails (past 48h)\n" +
      "/status — View your account status\n" +
      "/stop — Disconnect your Gmail account\n" +
      "/help — Show this message"
    );
  });

  // ─── Start OAuth server ─────────────────────────────────
  const server = startServer(bot, async (chatId, refreshToken) => {
    const since = Date.now() - HOURS_48_MS;
    const count = await checkUserEmails(bot, chatId, refreshToken, since);

    if (count === 0) {
      await bot.sendMessage(chatId, "📭 No job-related emails found in the past 48 hours. I'll notify you when new ones arrive!");
    } else {
      await bot.sendMessage(chatId, `✅ Found ${count} job-related email(s) from the past 48 hours above.`);
    }
  });

  // ─── Polling loop ───────────────────────────────────────
  console.log(`📡 Polling every ${POLL_INTERVAL / 1000}s for job-related emails...`);

  async function poll() {
    const pollStart = Date.now();

    try {
      const users = await getAllUsers();
      if (users.length === 0) {
        console.log(`[${new Date().toLocaleTimeString()}] No active users to poll.`);
        return;
      }

      // Poll all users concurrently
      const results = await Promise.allSettled(
        users.map(async (user) => {
          const count = await checkUserEmails(bot, user.chat_id, user.refresh_token, user.last_check_time);
          if (count > 0) {
            console.log(`📨 Sent ${count} email(s) to user ${user.chat_id}`);
          }
          await updateLastCheckTime(user.chat_id, Date.now());
        })
      );

      // Handle per-user errors
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === "rejected") {
          const user = users[i];
          if (isInvalidGrant(result.reason)) {
            console.log(`🔑 Token expired for user ${user.chat_id}, removing...`);
            await handleExpiredToken(bot, user.chat_id);
          } else {
            console.error(`❌ Poll error for user ${user.chat_id}:`, result.reason);
          }
        }
      }

      // Prune old notified IDs to prevent memory leaks
      pruneNotifiedIds();
    } catch (err) {
      console.error("❌ Global poll error:", err);
    }

    const elapsed = Date.now() - pollStart;
    if (elapsed > POLL_INTERVAL) {
      console.warn(`⚠️ Poll cycle took ${elapsed}ms, exceeding the ${POLL_INTERVAL}ms interval.`);
    }
  }

  await poll();
  const pollTimer = setInterval(poll, POLL_INTERVAL);

  // ─── Graceful shutdown ──────────────────────────────────
  async function shutdown(signal: string) {
    console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);

    clearInterval(pollTimer);
    bot.stopPolling();
    server.close();
    await closePool();

    console.log("👋 Shutdown complete.");
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// Import getAuthUrl here to keep it co-located with usage
import { getAuthUrl } from "./gmail";

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
