const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { DB_PATH } = require("./config");

const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

async function initDb() {
  await run("PRAGMA foreign_keys = ON");

  await run(`
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_number INTEGER NOT NULL UNIQUE,
      question_text TEXT NOT NULL,
      option_1 TEXT NOT NULL,
      option_2 TEXT NOT NULL,
      option_3 TEXT NOT NULL,
      option_4 TEXT NOT NULL,
      correct_answer TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      total_questions_seen INTEGER NOT NULL DEFAULT 0,
      correct_answers_count INTEGER NOT NULL DEFAULT 0,
      total_hints_used INTEGER NOT NULL DEFAULT 0,
      total_time_seconds INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_activity_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS user_question_progress (
      user_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      times_attempted INTEGER NOT NULL DEFAULT 0,
      times_correct INTEGER NOT NULL DEFAULT 0,
      times_hint_used INTEGER NOT NULL DEFAULT 0,
      last_attempted_at TEXT,
      PRIMARY KEY (user_id, question_id),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('learning', 'test')),
      question_ids TEXT NOT NULL,
      current_index INTEGER NOT NULL DEFAULT 0,
      correct_answers INTEGER NOT NULL DEFAULT 0,
      hints_used INTEGER NOT NULL DEFAULT 0,
      total_seconds INTEGER NOT NULL DEFAULT 0,
      last_question_started_at TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS user_tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      session_id INTEGER NOT NULL,
      total_questions INTEGER NOT NULL,
      correct_answers INTEGER NOT NULL,
      score_percentage REAL NOT NULL,
      duration_seconds INTEGER NOT NULL,
      completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES user_sessions(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS hint_cache (
      question_id INTEGER PRIMARY KEY,
      hint_text TEXT NOT NULL,
      model TEXT NOT NULL,
      generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS session_question_hints (
      session_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      hints_used INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (session_id, question_id),
      FOREIGN KEY (session_id) REFERENCES user_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS hint_cache_levels (
      question_id INTEGER NOT NULL,
      hint_level INTEGER NOT NULL,
      hint_text TEXT NOT NULL,
      model TEXT NOT NULL,
      generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (question_id, hint_level),
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
    )
  `);

  await run("CREATE INDEX IF NOT EXISTS idx_questions_number ON questions(question_number)");
  await run("CREATE INDEX IF NOT EXISTS idx_sessions_user_status ON user_sessions(user_id, status)");

  // Migrations for columns added after initial schema
  try {
    await run("ALTER TABLE user_question_progress ADD COLUMN last_correct_at TEXT");
  } catch (_) {
    // Column already exists
  }

  try {
    await run("ALTER TABLE users ADD COLUMN reminder_time TEXT");
  } catch (_) {
    // Column already exists
  }
}

module.exports = {
  db,
  run,
  get,
  all,
  initDb,
};
