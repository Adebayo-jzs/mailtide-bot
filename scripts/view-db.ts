import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  try {
    const res = await pool.query(`
      SELECT
        chat_id,
        substring(refresh_token from 1 for 20) || '...' AS token_preview,
        to_char(to_timestamp(last_check_time / 1000), 'YYYY-MM-DD HH24:MI:SS') AS last_checked
      FROM users
    `);

    if (res.rows.length === 0) {
      console.log("No users in the database.");
    } else {
      console.table(res.rows);
    }
  } catch (err) {
    console.error("Failed to query database:", err);
  } finally {
    await pool.end();
  }
}

main();
