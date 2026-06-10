# Gmail → Telegram Bot

Gets notified on Telegram whenever you receive a new Gmail email.

## Stack
- Node.js + TypeScript
- `node-telegram-bot-api`
- Gmail API (OAuth2)

---

## Setup

### 1. Create a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the **bot token** — this is your `TELEGRAM_BOT_TOKEN`

### 2. Get your Telegram Chat ID

1. Start a conversation with your new bot (send it any message)
2. Visit: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
3. Find `"chat":{"id":...}` — that number is your `TELEGRAM_CHAT_ID`

### 3. Set up Gmail API credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable the **Gmail API**
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
5. Select **Desktop App** as the application type
6. Download the credentials and note the **Client ID** and **Client Secret**

### 4. Configure environment

```bash
cp .env.example .env
```

Fill in `.env` with your `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `GMAIL_CLIENT_ID`, and `GMAIL_CLIENT_SECRET`.

### 5. Get your Gmail refresh token

```bash
npm run get-token
```

Follow the prompts — it'll open an auth URL, you authorize it, paste the code back, and you'll get a `GMAIL_REFRESH_TOKEN`. Add it to your `.env`.

### 6. Run the bot

```bash
npm start
```

The bot will send you a startup message on Telegram and begin checking for new emails every 60 seconds (configurable via `POLL_INTERVAL_MS` in `.env`).

---

## Project Structure

```
src/
  index.ts     — main polling loop
  gmail.ts     — Gmail API integration
  telegram.ts  — Telegram bot & message formatting
scripts/
  get-token.ts — one-time OAuth2 setup helper
```

## Deploy

For always-on notifications, deploy to a cheap VPS (Railway, Render, Fly.io) or run with `pm2`:

```bash
npm run build
pm2 start dist/src/index.js --name gmail-bot
```
