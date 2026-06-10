import TelegramBot from "node-telegram-bot-api";
import { EmailSummary, JobEmailCategory } from "./gmail";

export function createBot(): TelegramBot {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return new TelegramBot(token, { polling: true });
}

const CATEGORY_META: Record<
  JobEmailCategory,
  { emoji: string; label: string }
> = {
  offer:                { emoji: "🎉", label: "Job Offer" },
  interview:            { emoji: "📅", label: "Interview Invitation" },
  rejection:            { emoji: "❌", label: "Rejection" },
  application_received: { emoji: "✅", label: "Application Received" },
  assessment:           { emoji: "🧪", label: "Assessment / Test" },
  follow_up:            { emoji: "🔁", label: "Follow-Up" },
  other_job:            { emoji: "💼", label: "Job-Related" },
};

export function formatJobEmail(email: EmailSummary): string {
  const { emoji, label } = CATEGORY_META[email.category];

  return (
    `${emoji} ${label}\n\n` +
    `From: ${email.from}\n` +
    `Subject: ${email.subject}\n` +
    `Date: ${email.date}\n\n` +
    `${truncate(email.snippet, 250)}`
  );
}

export async function sendJobNotification(
  bot: TelegramBot,
  chatId: number,
  email: EmailSummary
): Promise<void> {
  await bot.sendMessage(chatId, formatJobEmail(email), {
    disable_web_page_preview: true,
  });
}

export async function sendStatusMessage(
  bot: TelegramBot,
  chatId: number,
  text: string
): Promise<void> {
  await bot.sendMessage(chatId, text);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + "…";
}

