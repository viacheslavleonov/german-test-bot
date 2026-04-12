const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const TEST_QUESTION_COUNT = Number(process.env.TEST_QUESTION_COUNT || 30);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "bot.sqlite");

const ALLOWED_TELEGRAM_USERS = (process.env.ALLOWED_TELEGRAM_USERS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean)
  .map((item) => Number(item))
  .filter((item) => Number.isInteger(item));

const REMINDER_TIME = process.env.REMINDER_TIME || "0 20 * * *";

if (!TELEGRAM_BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN is required in .env");
}

module.exports = {
  TELEGRAM_BOT_TOKEN,
  OPENAI_API_KEY,
  OPENAI_MODEL,
  TEST_QUESTION_COUNT,
  DB_PATH,
  ALLOWED_TELEGRAM_USERS,
  REMINDER_TIME,
};
