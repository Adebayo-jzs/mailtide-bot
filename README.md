# 💼 MailTide — Job Application Tracker for Telegram

A Telegram bot that monitors your Gmail inbox for job-related emails and sends instant, categorized notifications — so you never miss an interview invite, offer, or update.

> **Multi-user** · **OAuth2 web flow** · **Encrypted token storage** · **Keyword-based classification**

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔐 **Secure OAuth2** | Users connect via a browser-based Google sign-in — no tokens shared in chat |
| 👥 **Multi-user** | Supports unlimited users, each with their own Gmail connection |
| 🗄️ **PostgreSQL** | Persistent storage for user sessions with automatic schema migration |
| 🔒 **AES-256-GCM** | Refresh tokens encrypted at rest with authenticated encryption |
| 📊 **Smart Classification** | Categorizes emails into 7 types: Offer, Interview, Rejection, Assessment, Application Received, Follow-Up, and Other Job-Related |
| ⏱️ **Configurable Polling** | Adjustable check interval (default: 60 seconds) |
| 🌐 **Landing Page** | Static HTML landing page and privacy policy served via Express |
| 🩺 **Health Check** | Built-in `/health` endpoint for uptime monitoring |

---

## 📋 Bot Commands

| Command | Description |
|---|---|
| `/start` | Connect your Gmail account via OAuth2 |
| `/check` | Manually scan your inbox for job emails (past 48 hours) |
| `/status` | View your connection status and last check time |
| `/stop` | Disconnect your Gmail and delete your data |
| `/help` | Show all available commands |

---

## 🛠️ Tech Stack

- **Runtime:** Node.js + TypeScript
- **Bot:** `node-telegram-bot-api` (long-polling)
- **Email:** Gmail API via `googleapis`
- **Server:** Express (OAuth2 callback + static files)
- **Database:** PostgreSQL via `pg`
- **Security:** AES-256-GCM encryption (Node.js `crypto`)

---

## 🚀 Setup

### 1. Create a Telegram Bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Copy the **bot token** — this is your `TELEGRAM_BOT_TOKEN`

### 2. Set up Gmail API Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Enable the **Gmail API**
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
5. Select **Web application** as the application type
6. Add your redirect URI (e.g., `http://localhost:3000/oauth2callback` for local dev)
7. Note the **Client ID** and **Client Secret**

### 3. Set up PostgreSQL

Provision a PostgreSQL database (local, [Neon](https://neon.tech/), [Supabase](https://supabase.com/), etc.) and note the connection string.

### 4. Generate an Encryption Key

Generate a 32-byte (64 hex character) encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 5. Configure Environment

```bash
cp .env.example .env
```

Fill in your `.env`:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
GMAIL_CLIENT_ID=your_client_id
GMAIL_CLIENT_SECRET=your_client_secret
GMAIL_REDIRECT_URI=http://localhost:3000/oauth2callback
DATABASE_URL=postgresql://user:password@host:port/dbname
ENCRYPTION_KEY=your_64_char_hex_key
PORT=3000
POLL_INTERVAL_MS=60000
```

### 6. Install Dependencies & Run

```bash
npm install
npm start
```

The bot will:
- Initialize the database schema
- Start the Telegram bot (long-polling)
- Launch the Express server for OAuth2 callbacks on the configured port
- Begin polling all connected users' inboxes for job emails

---

## 📁 Project Structure

```
src/
  index.ts       — main entry point, bot commands, polling loop
  gmail.ts       — Gmail API client, email fetching, keyword classification
  telegram.ts    — Telegram bot setup, message formatting
  server.ts      — Express server (OAuth2 callback, static files, health check)
  db.ts          — PostgreSQL connection, user CRUD, AES-256-GCM encryption
scripts/
  view-db.ts     — utility to inspect the database
public/
  index.html     — landing page
  privacy.html   — privacy policy
```

---

## 📧 Email Categories

The bot classifies incoming emails using keyword matching on the subject and snippet:

| Emoji | Category | Example Keywords |
|---|---|---|
| 🎉 | **Job Offer** | "offer letter", "pleased to offer", "welcome to the team" |
| 📅 | **Interview** | "interview invitation", "schedule a call", "technical interview" |
| ❌ | **Rejection** | "unfortunately", "not moving forward", "position has been filled" |
| 🧪 | **Assessment** | "coding challenge", "technical test", "hackerrank" |
| ✅ | **Application Received** | "thank you for applying", "application confirmation" |
| 🔁 | **Follow-Up** | "following up", "update on your application" |
| 💼 | **Other Job-Related** | Generic matches: "application", "recruiter", "candidate" |

---

## 🚢 Deployment

For always-on notifications, deploy to a VPS or managed platform:

### Build & Run with PM2

```bash
npm run build
pm2 start dist/index.js --name mailtide-bot
```

### Recommended Platforms

- [Railway](https://railway.app/) — deploy with built-in PostgreSQL
- [Render](https://render.com/) — free tier web service + managed Postgres
- [Fly.io](https://fly.io/) — edge deployment with persistent volumes

> **Important:** Your `GMAIL_REDIRECT_URI` must match the public URL of your deployed server (e.g., `https://your-app.railway.app/oauth2callback`). Update both your `.env` and the Google Cloud Console authorized redirect URIs.

---

## 🔒 Security Notes

- **Refresh tokens** are encrypted with AES-256-GCM before being stored in the database
- **Gmail scope** is read-only (`gmail.readonly`) — the bot cannot send, modify, or delete emails
- Users can disconnect at any time with `/stop`, which deletes all their data
- The `/health` endpoint returns a simple `OK` for monitoring — no sensitive data is exposed

---

## 📄 License

ISC
