import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "data.sqlite");
const db = new Database(dbPath);

const users = db.prepare(`
  SELECT 
    chat_id,
    substr(refresh_token, 1, 20) || '...' as token_preview,
    datetime(last_check_time / 1000, 'unixepoch', 'localtime') as last_checked
  FROM users
`).all();

if (users.length === 0) {
  console.log("No users in the database.");
} else {
  console.table(users);
}

db.close();
