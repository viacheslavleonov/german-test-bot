const TelegramBot = require("node-telegram-bot-api");
const {
  TELEGRAM_BOT_TOKEN,
  ALLOWED_TELEGRAM_USERS,
} = require("./config");
const { initDb } = require("./db");
const { registerCommandHandlers } = require("./handlers/commands");
const { registerMessageHandler } = require("./handlers/messageHandler");

function isAuthorized(msg) {
  const userId = msg.from && msg.from.id;
  if (!userId) {
    return false;
  }
  if (ALLOWED_TELEGRAM_USERS.length === 0) {
    return false;
  }
  return ALLOWED_TELEGRAM_USERS.includes(userId);
}

function withAuthorization(bot, handler) {
  return async (...args) => {
    const msg = args[0];
    if (!isAuthorized(msg)) {
      return;
    }

    try {
      await handler(...args);
    } catch (error) {
      console.error("Handler error:", error);
      if (msg && msg.chat && msg.chat.id) {
        await bot.sendMessage(msg.chat.id, "Внутренняя ошибка. Попробуй еще раз.");
      }
    }
  };
}

async function bootstrap() {
  await initDb();

  const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
    polling: true,
  });

  const originalOnText = bot.onText.bind(bot);
  bot.onText = (regexp, callback) => originalOnText(regexp, withAuthorization(bot, callback));

  const originalOn = bot.on.bind(bot);
  bot.on = (eventName, callback) => originalOn(eventName, withAuthorization(bot, callback));

  await bot.setMyCommands([
    { command: "start", description: "🇩🇪 Начать работу с ботом" },
    { command: "learn", description: "📘 Режим обучения" },
    { command: "test", description: "🧪 Пробный тест (30 вопросов)" },
    { command: "stats", description: "📊 Моя статистика" },
    { command: "hint", description: "💡 Подсказка (в /learn)" },
    { command: "cancel", description: "🛑 Завершить сессию" },
    { command: "help", description: "❓ Справка" },
  ]);

  registerCommandHandlers(bot);
  registerMessageHandler(bot);

  console.log("Bot started with polling mode.");
}

bootstrap().catch((error) => {
  console.error("Failed to start bot:", error);
  process.exit(1);
});
