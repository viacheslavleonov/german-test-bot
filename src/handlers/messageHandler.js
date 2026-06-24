const {
  ensureUser,
  getActiveSession,
  getCurrentQuestionForSession,
  answerCurrentQuestion,
  getSessionQuestionCount,
  trackHintUsage,
  trackFullHintUsage,
  revealCurrentAnswer,
  startFilteredSession,
} = require("../services/quizService");
const { answerFreeform, regenerateHint } = require("../services/llmService");
const {
  formatQuestion,
  formatAnswerFeedback,
  formatHintMessage,
  buildHintReplyMarkup,
  formatRevealAnswerMessage,
  formatSessionMessage,
  formatTestResult,
  buildQuestionReplyMarkup,
} = require("../utils/messages");
const { getHint } = require("../services/llmService");
const { getImagePathForQuestion } = require("../utils/images");
const { getQuestionById } = require("../services/questionService");

const ANSWER_REGEX = /^[1-4]$/;

async function sendNextQuestion(bot, chatId, session, question) {
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

async function processAnswer(bot, userId, chatId, answerNumber) {
  const result = await answerCurrentQuestion(userId, answerNumber);

  await bot.sendMessage(
    chatId,
    formatAnswerFeedback(result.isCorrect, result.correctIndex + 1, result.correctAnswer)
  );

  if (result.completed) {
    if (result.session.mode === "test") {
      const totalQuestions = await getSessionQuestionCount(result.session);
      await bot.sendMessage(
        chatId,
        formatTestResult(
          result.session.correct_answers,
          totalQuestions,
          result.session.total_seconds
        )
      );
    } else {
      await bot.sendMessage(chatId, formatSessionMessage("learningCompleted"));
    }
    return;
  }

  const refreshedSession = await getActiveSession(userId);
  const nextQuestion = await getCurrentQuestionForSession(refreshedSession);
  await sendNextQuestion(bot, chatId, refreshedSession, nextQuestion);
}

function registerMessageHandler(bot) {
  bot.on("callback_query", async (query) => {
    const userId = query.from.id;
    const chatId = query.message && query.message.chat ? query.message.chat.id : null;
    if (!chatId) {
      return;
    }

    await ensureUser(query.from);

    // Handle review filter selection — no active session required
    if (query.data && query.data.startsWith("review_filter:")) {
      const filter = query.data.replace("review_filter:", "");
      await bot.answerCallbackQuery(query.id);

      try {
        const startResult = await startFilteredSession(userId, filter);
        if (startResult.isEmpty) {
          const labels = {
            wrong: "неверных ответов",
            hint1: "вопросов с подсказкой ур.1",
            hint2: "вопросов с подсказкой ур.2",
            hint3: "вопросов с подсказкой ур.3",
          };
          const label = labels[filter] || "вопросов";
          await bot.sendMessage(chatId, `ℹ️ Нет ${label} в истории. Начни с /learn.`);
          return;
        }

        const question = await getCurrentQuestionForSession(startResult.session);
        await bot.sendMessage(chatId, formatSessionMessage("learningStarted"));
        await sendNextQuestion(bot, chatId, startResult.session, question);
      } catch (error) {
        await bot.sendMessage(chatId, "Не удалось запустить сессию. Попробуй ещё раз.");
      }
      return;
    }

    const session = await getActiveSession(userId);

    if (!session) {
      await bot.answerCallbackQuery(query.id, { text: "Нет активной сессии." });
      return;
    }

    const hintMatch = /^hint:(\d+)$/.exec(query.data || "");
    if (hintMatch) {
      if (session.mode !== "learning") {
        await bot.answerCallbackQuery(query.id, { text: "Подсказка только в /learn" });
        return;
      }

      const questionId = Number(hintMatch[1]);
      try {
        const hintState = await trackHintUsage(userId, questionId);
        if (hintState.hintLevel > 3) {
          await bot.answerCallbackQuery(query.id, {
            text: "Максимум подсказок. Нажми 'Показать ответ'.",
          });
          return;
        }

        await bot.answerCallbackQuery(query.id, {
          text: `Подсказка ${hintState.hintLevel}/3`,
        });
        const hint = await getHint(hintState.question, session.mode, hintState.hintLevel);
        await bot.sendMessage(
          chatId,
          formatHintMessage(hintState.hintLevel, hint),
          buildHintReplyMarkup(hintState.question.id, hintState.hintLevel)
        );
      } catch (error) {
        await bot.answerCallbackQuery(query.id, { text: "Ошибка подсказки" });
        await bot.sendMessage(chatId, "Не удалось получить подсказку от ИИ. Попробуй чуть позже.");
      }
      return;
    }

    const translateMatch = /^translate:(\d+)$/.exec(query.data || "");
    if (translateMatch) {
      if (session.mode !== "learning") {
        await bot.answerCallbackQuery(query.id, { text: "Перевод только в /learn" });
        return;
      }

      const questionId = Number(translateMatch[1]);
      try {
        const hintState = await trackFullHintUsage(userId, questionId);
        await bot.answerCallbackQuery(query.id, { text: "Перевожу (полная подсказка)..." });
        const translation = await require("../services/llmService").getTranslation(hintState.question, session.mode);
        await bot.sendMessage(
          chatId,
          formatHintMessage(3, translation),
          buildHintReplyMarkup(hintState.question.id, 3)
        );
      } catch (error) {
        await bot.answerCallbackQuery(query.id, { text: "Ошибка перевода" });
        await bot.sendMessage(chatId, "Не удалось получить перевод от ИИ. Попробуй чуть позже.");
      }
      return;
    }

    const regenMatch = /^regen:(\d+):(\d+)$/.exec(query.data || "");
    if (regenMatch) {
      if (session.mode !== "learning") {
        await bot.answerCallbackQuery(query.id, { text: "Только в режиме /learn" });
        return;
      }

      const questionId = Number(regenMatch[1]);
      const level = Number(regenMatch[2]);

      const currentQuestion = await getCurrentQuestionForSession(session);
      if (!currentQuestion || currentQuestion.id !== questionId) {
        await bot.answerCallbackQuery(query.id, {
          text: "Эта подсказка уже неактуальна для текущего вопроса",
        });
        return;
      }

      await bot.answerCallbackQuery(query.id, { text: "Перегенерирую через GPT-5.4..." });

      try {
        const dbQuestion = await getQuestionById(questionId);
        if (!dbQuestion) {
          await bot.sendMessage(chatId, "Не удалось загрузить вопрос для регенерации подсказки.");
          return;
        }

        const regenerated = await regenerateHint(dbQuestion, session.mode, level);
        await bot.sendMessage(
          chatId,
          formatHintMessage(level, regenerated),
          buildHintReplyMarkup(questionId, level)
        );
      } catch (error) {
        await bot.sendMessage(chatId, "Не удалось перегенерировать подсказку. Попробуй еще раз.");
      }

      return;
    }

    if (query.data === "show_answer") {
      if (session.mode !== "learning") {
        await bot.answerCallbackQuery(query.id, { text: "Только в режиме /learn" });
        return;
      }

      await bot.answerCallbackQuery(query.id);
      const reveal = await revealCurrentAnswer(userId);
      await bot.sendMessage(
        chatId,
        formatRevealAnswerMessage(reveal.correctIndex + 1, reveal.correctAnswer)
      );

      if (reveal.completed) {
        await bot.sendMessage(chatId, formatSessionMessage("learningCompleted"));
        return;
      }

      const refreshedSession = await getActiveSession(userId);
      const nextQuestion = await getCurrentQuestionForSession(refreshedSession);
      await sendNextQuestion(bot, chatId, refreshedSession, nextQuestion);
      return;
    }

    const answerMatch = /^answer:([1-4])$/.exec(query.data || "");
    if (!answerMatch) {
      await bot.answerCallbackQuery(query.id, { text: "Неизвестное действие" });
      return;
    }

    await bot.answerCallbackQuery(query.id);
    await processAnswer(bot, userId, chatId, Number(answerMatch[1]));
  });

  bot.on("message", async (msg) => {
    if (!msg.text) {
      return;
    }

    if (msg.text.startsWith("/")) {
      return;
    }

    await ensureUser(msg.from);

    const chatId = msg.chat.id;
    const session = await getActiveSession(msg.from.id);
    if (!session) {
      await bot.sendMessage(chatId, "Нет активной сессии. Используй /learn или /test.");
      return;
    }

    const text = msg.text.trim();

    if (text === "подсказка" || text === "хинт") {
      await bot.sendMessage(chatId, "Для подсказки используй команду /hint.");
      return;
    }

    if (ANSWER_REGEX.test(text)) {
      await processAnswer(bot, msg.from.id, chatId, Number(text));
      return;
    }

    const question = await getCurrentQuestionForSession(session);
    if (!question) {
      await bot.sendMessage(chatId, "Не удалось найти текущий вопрос.");
      return;
    }

    try {
      const answer = await answerFreeform(text, question, session.mode);
      await bot.sendMessage(chatId, answer);
    } catch (error) {
      await bot.sendMessage(chatId, "Сейчас не удалось получить ответ от ИИ. Попробуй позже.");
    }
  });
}

module.exports = {
  registerMessageHandler,
};
