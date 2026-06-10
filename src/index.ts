import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";
import { createBot, sendJobNotification, sendStatusMessage } from "./telegram";
import { createGmailClient, fetchJobEmails, getAuthUrl } from "./gmail";
import { startServer } from "./server";
import { getAllUsers, getUser, deleteUser, updateLastCheckTime } from "./db";

function isInvalidGrant(err: unknown): boolean {
  return err instanceof Error && err.message.includes("invalid_grant");
}

async function handleExpiredToken(bot: TelegramBot, chatId: number) {
  deleteUser(chatId);
  notifiedIds.delete(chatId);
  await bot.sendMessage(
    chatId,
    "⚠️ Your Google access has expired or been revoked.\n\n" +
    "Please reconnect using /start"
  ).catch(() => {});
}

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS ?? "60000", 10);
const HOURS_48_MS = 48 * 60 * 60 * 1000;

// Track notified email IDs per user to avoid duplicate notifications
const notifiedIds = new Map<number, Set<string>>();

function getUserNotified(chatId: number): Set<string> {
  if (!notifiedIds.has(chatId)) {
    notifiedIds.set(chatId, new Set());
  }
  return notifiedIds.get(chatId)!;
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
    userNotified.add(email.id);
    console.log(`  [${email.category}] "${email.subject}" from ${email.from}`);
  }

  return newEmails.length;
}

async function main() {
  console.log("🤖 Multi-User Job Application Bot starting...");

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
  const users = getAllUsers();
  for (const user of users) {
    bot.sendMessage(
      user.chat_id,
      "💼 Job Application Bot started!\n\nWatching your inbox for:\n✅ Application confirmations\n📅 Interview invitations\n🧪 Assessments\n🎉 Job offers\n❌ Rejections\n🔁 Follow-ups"
    ).catch((err) => console.error(`Failed to send startup msg to ${user.chat_id}:`, err));
  }

  // ─── /start ─────────────────────────────────────────────
  bot.onText(/^\/start/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const existing = getUser(chatId);

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
    const user = getUser(chatId);

    if (!user) {
      bot.sendMessage(chatId, "❌ You're not connected yet. Use /start to sign in first.");
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
    const user = getUser(chatId);

    if (!user) {
      bot.sendMessage(chatId, "❌ You're not connected. Use /start to sign in.");
      return;
    }

    const lastCheck = new Date(user.last_check_time).toLocaleString();
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
    const user = getUser(chatId);

    if (!user) {
      bot.sendMessage(chatId, "You don't have an active connection.");
      return;
    }

    deleteUser(chatId);
    notifiedIds.delete(chatId);

    bot.sendMessage(
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
  startServer(bot, async (chatId, refreshToken) => {
    try {
      const since = Date.now() - HOURS_48_MS;
      const count = await checkUserEmails(bot, chatId, refreshToken, since);

      if (count === 0) {
        await bot.sendMessage(chatId, "📭 No job-related emails found in the past 48 hours. I'll notify you when new ones arrive!");
      } else {
        await bot.sendMessage(chatId, `✅ Found ${count} job-related email(s) from the past 48 hours above.`);
      }
    } catch (err) {
      console.error(`❌ Post-auth check error for ${chatId}:`, err);
    }
  });

  // ─── Polling loop ───────────────────────────────────────
  console.log(`📡 Polling every ${POLL_INTERVAL / 1000}s for job-related emails...`);

  async function poll() {
    try {
      const users = getAllUsers();
      if (users.length === 0) {
        console.log(`[${new Date().toLocaleTimeString()}] No active users to poll.`);
        return;
      }

      for (const user of users) {
        try {
          const count = await checkUserEmails(bot, user.chat_id, user.refresh_token, user.last_check_time);
          if (count > 0) {
            console.log(`📨 Sent ${count} email(s) to user ${user.chat_id}`);
          }
          updateLastCheckTime(user.chat_id, Date.now());
        } catch (err) {
          if (isInvalidGrant(err)) {
            console.log(`🔑 Token expired for user ${user.chat_id}, removing...`);
            await handleExpiredToken(bot, user.chat_id);
          } else {
            console.error(`❌ Poll error for user ${user.chat_id}:`, err);
          }
        }
      }
    } catch (err) {
      console.error("❌ Global poll error:", err);
    }
  }

  await poll();
  setInterval(poll, POLL_INTERVAL);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

