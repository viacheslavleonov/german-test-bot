const {
  ensureUser,
  getActiveSession,
  startSession,
  getCurrentQuestionForSession,
  cancelSession,
  getStats,
  getSessionQuestionCount,
  hasAnyQuestions,
  trackHintUsage,
} = require("../services/quizService");
const { getHint } = require("../services/llmService");
const {
  introMessage,
  formatQuestion,
  formatStats,
  formatHintMessage,
  buildHintReplyMarkup,
  formatSessionMessage,
  buildQuestionReplyMarkup,
  formatReviewMenu,
  buildReviewMenuMarkup,
} = require("../utils/messages");
const { getImagePathForQuestion } = require("../utils/images");
const { run, get } = require("../db");

async function sendCurrentQuestion(bot, chatId, session) {
  const question = await getCurrentQuestionForSession(session);
  if (!question) {
    await bot.sendMessage(chatId, "Вопрос не найден. Попробуй /learn или /test заново.");
    return;
  }

  const imagePath = getImagePathForQuestion(question.question_number);
  const total = await getSessionQuestionCount(session);
  const questionText = formatQuestion(question, session.mode, session.current_index, total);

  if (imagePath) {
    await bot.sendPhoto(chatId, imagePath, {
      caption: questionText,
      ...buildQuestionReplyMarkup(session.mode, question.id),
    });
    return;
  }

  await bot.sendMessage(chatId, questionText, buildQuestionReplyMarkup(session.mode, question.id));
}

function registerCommandHandlers(bot) {
  bot.onText(/^\/start$/, async (msg) => {
    await ensureUser(msg.from);
    await bot.sendMessage(msg.chat.id, introMessage());
  });

  bot.onText(/^\/help$/, async (msg) => {
    await ensureUser(msg.from);
    await bot.sendMessage(msg.chat.id, introMessage());
  });

  bot.onText(/^\/learn$/, async (msg) => {
    await ensureUser(msg.from);

    const questionsOk = await hasAnyQuestions();
    if (!questionsOk) {
      await bot.sendMessage(msg.chat.id, "База вопросов пустая. Сначала выполни миграцию.");
      return;
    }

    const { session, resumed } = await startSession(msg.from.id, "learning");
    if (resumed) {
      await bot.sendMessage(msg.chat.id, formatSessionMessage("resumed"));
    } else {
      await bot.sendMessage(msg.chat.id, formatSessionMessage("learningStarted"));
    }
    await sendCurrentQuestion(bot, msg.chat.id, session);
  });

  // Start a fresh learning session with all questions in random order
  bot.onText(/^\/learnall$/, async (msg) => {
    await ensureUser(msg.from);

    const questionsOk = await hasAnyQuestions();
    if (!questionsOk) {
      await bot.sendMessage(msg.chat.id, "База вопросов пустая. Сначала выполни миграцию.");
      return;
    }

    // Cancel any existing session so we always create a new randomized session
    await cancelSession(msg.from.id);

    const { session } = await startSession(msg.from.id, "learning");
    await bot.sendMessage(msg.chat.id, formatSessionMessage("learningStarted"));
    await sendCurrentQuestion(bot, msg.chat.id, session);
  });

  bot.onText(/^\/test$/, async (msg) => {
    await ensureUser(msg.from);

    const questionsOk = await hasAnyQuestions();
    if (!questionsOk) {
      await bot.sendMessage(msg.chat.id, "База вопросов пустая. Сначала выполни миграцию.");
      return;
    }

    const { session, resumed } = await startSession(msg.from.id, "test");
    if (resumed) {
      await bot.sendMessage(msg.chat.id, formatSessionMessage("resumed"));
    } else {
      await bot.sendMessage(msg.chat.id, formatSessionMessage("testStarted"));
    }
    await sendCurrentQuestion(bot, msg.chat.id, session);
  });

  bot.onText(/^\/stats$/, async (msg) => {
    await ensureUser(msg.from);
    const stats = await getStats(msg.from.id);
    await bot.sendMessage(msg.chat.id, formatStats(stats));
  });

  bot.onText(/^\/cancel$/, async (msg) => {
    await ensureUser(msg.from);
    const cancelled = await cancelSession(msg.from.id);
    if (cancelled) {
      await bot.sendMessage(msg.chat.id, formatSessionMessage("cancelled"));
    } else {
      await bot.sendMessage(msg.chat.id, formatSessionMessage("noActive"));
    }
  });

  bot.onText(/^\/review$/, async (msg) => {
    await ensureUser(msg.from);

    const questionsOk = await hasAnyQuestions();
    if (!questionsOk) {
      await bot.sendMessage(msg.chat.id, "База вопросов пустая. Сначала выполни миграцию.");
      return;
    }

    await bot.sendMessage(msg.chat.id, formatReviewMenu(), buildReviewMenuMarkup());
  });

  bot.onText(/^\/hint$/, async (msg) => {
    await ensureUser(msg.from);

    const session = await getActiveSession(msg.from.id);
    if (!session) {
      await bot.sendMessage(msg.chat.id, "Нет активной сессии. Используй /learn.");
      return;
    }

    if (session.mode !== "learning") {
      await bot.sendMessage(msg.chat.id, "Подсказки доступны только в режиме /learn.");
      return;
    }

    try {
      const hintState = await trackHintUsage(msg.from.id);
      if (hintState.hintLevel > 3) {
        await bot.sendMessage(msg.chat.id, "Это уже максимум подсказок для вопроса. Можно нажать кнопку 'Показать ответ'.");
        return;
      }

      const hint = await getHint(hintState.question, session.mode, hintState.hintLevel);
      await bot.sendMessage(
        msg.chat.id,
        formatHintMessage(hintState.hintLevel, hint),
        buildHintReplyMarkup(hintState.question.id, hintState.hintLevel)
      );
    } catch (error) {
      await bot.sendMessage(msg.chat.id, "Не удалось получить подсказку от ИИ. Попробуй чуть позже.");
    }
  });
  bot.onText(/^\/remind(?:\s+(.+))?$/, async (msg, match) => {
    await ensureUser(msg.from);
    const arg = (match[1] || "").trim();

    if (!arg) {
      const user = await get("SELECT reminder_time FROM users WHERE user_id = ?", [msg.from.id]);
      const current = user && user.reminder_time;
      await bot.sendMessage(
        msg.chat.id,
        current
          ? `⏰ Напоминание установлено на ${current}.\nЧтобы изменить: /remind 20:00\nЧтобы отключить: /remind off`
          : "⏰ Напоминание не установлено.\nЧтобы включить: /remind 20:00"
      );
      return;
    }

    if (arg === "off" || arg === "выкл") {
      await run("UPDATE users SET reminder_time = NULL WHERE user_id = ?", [msg.from.id]);
      await bot.sendMessage(msg.chat.id, "🔕 Напоминание отключено.");
      return;
    }

    const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(arg);
    if (!timeMatch) {
      await bot.sendMessage(msg.chat.id, "Формат: /remind 20:00 или /remind off");
      return;
    }

    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2]);
    if (hours > 23 || minutes > 59) {
      await bot.sendMessage(msg.chat.id, "Некорректное время. Пример: /remind 20:00");
      return;
    }

    const timeStr = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    await run("UPDATE users SET reminder_time = ? WHERE user_id = ?", [timeStr, msg.from.id]);
    await bot.sendMessage(msg.chat.id, `⏰ Напоминание установлено на ${timeStr} каждый день.`);
  });
}

module.exports = {
  registerCommandHandlers,
};
