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
  formatSessionMessage,
  buildQuestionReplyMarkup,
} = require("../utils/messages");
const { getImagePathForQuestion } = require("../utils/images");

async function sendCurrentQuestion(bot, chatId, session) {
  const question = await getCurrentQuestionForSession(session);
  if (!question) {
    await bot.sendMessage(chatId, "Вопрос не найден. Попробуй /learn или /test заново.");
    return;
  }

  const imagePath = getImagePathForQuestion(question.question_number);
  if (imagePath) {
    await bot.sendPhoto(chatId, imagePath);
  }

  const total = await getSessionQuestionCount(session);
  await bot.sendMessage(
    chatId,
    formatQuestion(question, session.mode, session.current_index, total),
    buildQuestionReplyMarkup(session.mode)
  );
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
      await bot.sendMessage(msg.chat.id, formatHintMessage(hintState.hintLevel, hint));
    } catch (error) {
      await bot.sendMessage(msg.chat.id, "Не удалось получить подсказку от ИИ. Попробуй чуть позже.");
    }
  });
}

module.exports = {
  registerCommandHandlers,
};
