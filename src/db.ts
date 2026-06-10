import { Pool } from "pg";
import crypto from "crypto";

export interface User {
  chat_id: number;
  refresh_token: string;
  last_check_time: number;
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// AES-256-GCM encryption setup
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY; // Must be 32 bytes (64 hex chars or base64)
const ALGORITHM = "aes-256-gcm";

function encrypt(text: string): string {
  if (!ENCRYPTION_KEY) return text;
  
  const key = Buffer.from(ENCRYPTION_KEY, "hex");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars).");

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

function decrypt(text: string): string {
  if (!ENCRYPTION_KEY || !text.includes(":")) return text;

  const key = Buffer.from(ENCRYPTION_KEY, "hex");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars).");

  const [ivHex, authTagHex, encryptedHex] = text.split(":");
  if (!ivHex || !authTagHex || !encryptedHex) throw new Error("Invalid encrypted format");

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

// Initialize tables
export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      chat_id BIGINT PRIMARY KEY,
      refresh_token TEXT NOT NULL,
      last_check_time BIGINT NOT NULL
    )
  `);
}

export async function upsertUser(chatId: number, refreshToken: string) {
  const encryptedToken = encrypt(refreshToken);
  const now = Date.now();
  await pool.query(`
    INSERT INTO users (chat_id, refresh_token, last_check_time)
    VALUES ($1, $2, $3)
    ON CONFLICT(chat_id) DO UPDATE SET
      refresh_token = EXCLUDED.refresh_token
  `, [chatId, encryptedToken, now]);
}

export async function updateLastCheckTime(chatId: number, lastCheckTime: number) {
  await pool.query(
    "UPDATE users SET last_check_time = $1 WHERE chat_id = $2",
    [lastCheckTime, chatId]
  );
}

export async function getAllUsers(): Promise<User[]> {
  const res = await pool.query("SELECT * FROM users");
  return res.rows.map((row) => ({
    chat_id: Number(row.chat_id),
    refresh_token: decrypt(row.refresh_token),
    last_check_time: Number(row.last_check_time),
  }));
}

export async function getUser(chatId: number): Promise<User | undefined> {
  const res = await pool.query("SELECT * FROM users WHERE chat_id = $1", [chatId]);
  if (res.rows.length === 0) return undefined;
  
  const row = res.rows[0];
  return {
    chat_id: Number(row.chat_id),
    refresh_token: decrypt(row.refresh_token),
    last_check_time: Number(row.last_check_time),
  };
}

export async function deleteUser(chatId: number) {
  await pool.query("DELETE FROM users WHERE chat_id = $1", [chatId]);
}

