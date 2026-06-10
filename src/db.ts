import Database from "better-sqlite3";
import path from "path";

export interface User {
  chat_id: number;
  refresh_token: string;
  last_check_time: number;
}

const dbPath = path.join(process.cwd(), "data.sqlite");
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    chat_id INTEGER PRIMARY KEY,
    refresh_token TEXT NOT NULL,
    last_check_time INTEGER NOT NULL
  )
`);

export function upsertUser(chatId: number, refreshToken: string) {
  const stmt = db.prepare(`
    INSERT INTO users (chat_id, refresh_token, last_check_time)
    VALUES (?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      refresh_token = excluded.refresh_token
  `);
  // Initialize last_check_time to now so we don't spam old emails
  stmt.run(chatId, refreshToken, Date.now());
}

export function updateLastCheckTime(chatId: number, lastCheckTime: number) {
  db.prepare("UPDATE users SET last_check_time = ? WHERE chat_id = ?").run(lastCheckTime, chatId);
}

export function getAllUsers(): User[] {
  return db.prepare("SELECT * FROM users").all() as User[];
}

export function getUser(chatId: number): User | undefined {
  return db.prepare("SELECT * FROM users WHERE chat_id = ?").get(chatId) as User | undefined;
}

export function deleteUser(chatId: number) {
  db.prepare("DELETE FROM users WHERE chat_id = ?").run(chatId);
}
