import express from "express";
import TelegramBot from "node-telegram-bot-api";
import { createGmailClient } from "./gmail";
import { upsertUser } from "./db";
import path from "path";
import http from "http";

export function startServer(
  bot: TelegramBot,
  onUserAuthed?: (chatId: number, refreshToken: string) => Promise<void>
): http.Server {
  const app = express();
  const port = process.env.PORT || 3000;

  // Serve static files (like privacy.html) from the "public" folder
  app.use(express.static(path.join(process.cwd(), "public")));

  app.get("/oauth2callback", async (req, res) => {
    const code = req.query.code as string;
    const state = req.query.state as string; // This is the chatId

    if (!code || !state) {
      res.status(400).send("Missing code or state");
      return;
    }

    const chatId = parseInt(state, 10);

    if (isNaN(chatId)) {
      res.status(400).send("Invalid state parameter");
      return;
    }

    try {
      const auth = createGmailClient();
      const { tokens } = await auth.getToken(code);

      console.log("OAuth tokens received:", {
        has_access_token: !!tokens.access_token,
        has_refresh_token: !!tokens.refresh_token,
        token_type: tokens.token_type,
      });

      if (tokens.refresh_token) {
        await upsertUser(chatId, tokens.refresh_token);
        
        await bot.sendMessage(
          chatId,
          "✅ Authentication successful!\n\nYour Gmail account is now connected.\n\n🔍 Scanning your inbox for job emails from the past 48 hours..."
        ).catch((e) => console.error("Failed to send success message to telegram:", e));

        // Trigger the post-auth 48h email check (fire-and-forget with error logging)
        if (onUserAuthed) {
          onUserAuthed(chatId, tokens.refresh_token).catch((e) =>
            console.error(`❌ Post-auth check error for ${chatId}:`, e)
          );
        }

        res.send("Authentication successful! You can close this tab and return to Telegram.");
      } else {
        await bot.sendMessage(
          chatId,
          "⚠️ Google did not return a refresh token.\n\n" +
          "Please revoke access first:\n" +
          "1. Go to https://myaccount.google.com/permissions\n" +
          "2. Find this app and click 'Remove Access'\n" +
          "3. Then use /start again"
        ).catch((e) => console.error("Failed to send revoke message to telegram:", e));

        res.send("Google did not return a refresh token. Please revoke app access at https://myaccount.google.com/permissions and try /start again.");
      }
    } catch (err) {
      console.error("OAuth callback error:", err);
      res.status(500).send("Authentication failed");
    }
  });

  app.get("/health", (req, res) => {
    res.status(200).send("OK");
  });

  const server = app.listen(port, () => {
    console.log(`🌐 OAuth server listening on port ${port}`);
  });

  return server;
}

