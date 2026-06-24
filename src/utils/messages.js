const DIVIDER = "";

function introMessage() {
  return [
    "🇩🇪 Привет! Я помогу подготовиться к тесту на гражданство Германии.",
    "",
    DIVIDER,
    "📌 Команды:",
    "• /learn — режим обучения (все вопросы)",
    "• /review — повторить сложные вопросы (неверные / с подсказками)",
    "• /test — пробный тест (30 случайных вопросов)",
    "• /stats — статистика подготовки",
    "• /hint — подсказка к текущему вопросу (только в /learn)",
    "• /remind — напоминание о занятиях (напр. /remind 20:00)",
    "• /cancel — завершить текущую сессию",
    "• /help — показать это сообщение",
    "",
    "🧭 Как пользоваться:",
    "• Нажми кнопку 1-4 под вопросом (или отправь число 1-4 текстом).",
    "• В /learn доступны кнопки: Подсказка (3 уровня) и Показать ответ.",
    "• Любой другой текст — это вопрос к ИИ по текущему заданию.",
    DIVIDER,
  ].join("\n");
}

function formatQuestion(question, mode, currentIndex, totalQuestions) {
  const modeLabel = mode === "test" ? "🧪 Режим: тест" : "📘 Режим: обучение";
  return [
    DIVIDER,
    `${modeLabel}`,
    `❓ Вопрос ${currentIndex + 1} из ${totalQuestions} | №${question.question_number}`,
    "",
    question.question_text,
    "",
    "Варианты:",
    `1️⃣ ${question.option_1}`,
    `2️⃣ ${question.option_2}`,
    `3️⃣ ${question.option_3}`,
    `4️⃣ ${question.option_4}`,
    "",
    "👇 Выбери кнопку 1-4 (или отправь число 1-4).",
    DIVIDER,
  ].join("\n");
}

function buildQuestionReplyMarkup(mode) {
  const keyboard = [
    [
      { text: "1", callback_data: "answer:1" },
      { text: "2", callback_data: "answer:2" },
      { text: "3", callback_data: "answer:3" },
      { text: "4", callback_data: "answer:4" },
    ],
  ];

  if (mode === "learning") {
    keyboard.push([
      { text: "Подсказка", callback_data: "hint" },
      { text: "Показать ответ", callback_data: "show_answer" },
      { text: "Перевести", callback_data: "translate" },
    ]);
  }

  return {
    reply_markup: {
      inline_keyboard: keyboard,
    },
  };
}

function formatAnswerFeedback(isCorrect, correctOptionNumber, correctAnswerText) {
  if (isCorrect) {
    return [DIVIDER, "✅ Верно!", DIVIDER].join("\n");
  }
  return [
    DIVIDER,
    "❌ Неверно.",
    `🎯 Правильный ответ: ${correctOptionNumber}) ${correctAnswerText}`,
    DIVIDER,
  ].join("\n");
}

function formatHintMessage(level, hintText) {
  return [
    DIVIDER,
    `💡 Подсказка ${level}/3`,
    "",
    hintText,
    DIVIDER,
  ].join("\n");
}

function buildHintReplyMarkup(questionId, level) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "🔄 Перегенерировать (GPT-5.4)",
            callback_data: `regen:${questionId}:${level}`,
          },
        ],
      ],
    },
  };
}

function formatRevealAnswerMessage(correctOptionNumber, correctAnswerText) {
  return [
    DIVIDER,
    "🟢 Ответ открыт",
    `🎯 Правильный вариант: ${correctOptionNumber}) ${correctAnswerText}`,
    DIVIDER,
  ].join("\n");
}

function formatSessionMessage(kind) {
  const map = {
    learningStarted: "📘 Режим обучения запущен.",
    testStarted: "🧪 Тест запущен: 30 случайных вопросов.",
    resumed: "🔄 Продолжаем твою активную сессию.",
    noActive: "ℹ️ Активной сессии нет.",
    cancelled: "🛑 Текущая сессия завершена.",
    learningCompleted: "🏁 Сессия обучения завершена. Запусти /learn для нового круга.",
  };

  const text = map[kind] || "Готово.";
  return [DIVIDER, text, DIVIDER].join("\n");
}

function formatTestResult(correctAnswers, totalQuestions, durationSeconds) {
  const percentage = ((correctAnswers / totalQuestions) * 100).toFixed(1);
  return [
    DIVIDER,
    "🏁 Тест завершен!",
    `📈 Результат: ${correctAnswers}/${totalQuestions} (${percentage}%)`,
    `⏱️ Время: ${Math.round(durationSeconds)} сек.`,
    DIVIDER,
  ].join("\n");
}

function formatStats(stats) {
  const accuracy = stats.totalQuestionsSeen > 0
    ? ((stats.correctAnswersCount / stats.totalQuestionsSeen) * 100).toFixed(1)
    : "0.0";

  const lines = [
    DIVIDER,
    "📊 Твоя статистика:",
    `• Просмотрено вопросов: ${stats.totalQuestionsSeen}`,
    `• Верных ответов: ${stats.correctAnswersCount}`,
    `• Точность: ${accuracy}%`,
    `• Использовано подсказок: ${stats.totalHintsUsed}`,
    `• Суммарное время: ${stats.totalTimeSeconds} сек.`,
  ];

  if (stats.lastTests.length > 0) {
    lines.push("", "🧾 Последние тесты:");
    for (const test of stats.lastTests) {
      lines.push(
        `• ${test.completed_at}: ${test.correct_answers}/${test.total_questions} (${Number(
          test.score_percentage
        ).toFixed(1)}%), ${test.duration_seconds} сек.`
      );
    }
  }

  lines.push(DIVIDER);

  return lines.join("\n");
}

function formatDailyReminder(activeSession) {
  if (activeSession) {
    const questionIds = JSON.parse(activeSession.question_ids || "[]");
    const remaining = questionIds.length - activeSession.current_index;
    return [
      DIVIDER,
      "🌆 Вечерний привет!",
      "",
      `У тебя есть незавершённая сессия обучения — осталось ${remaining} вопросов.`,
      "Продолжим? Просто отправь /learn 👇",
      DIVIDER,
    ].join("\n");
  }

  return [
    DIVIDER,
    "🌆 Вечерний привет!",
    "",
    "Вечер — отличное время повторить немецкий. 🇩🇪",
    "• /learn — начать обучение",
    "• /review — повторить сложные вопросы",
    "• /test — проверить себя",
    DIVIDER,
  ].join("\n");
}

function formatReviewMenu() {
  return [
    DIVIDER,
    "🔁 Режим повторения",
    "",
    "Выбери какие вопросы хочешь повторить:",
    DIVIDER,
  ].join("\n");
}

function buildReviewMenuMarkup() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "❌ Неверные ответы", callback_data: "review_filter:wrong" }],
        [{ text: "💡 Использовал подсказку (ур.1+)", callback_data: "review_filter:hint1" }],
        [{ text: "💡💡 Использовал 2+ подсказки (ур.2+)", callback_data: "review_filter:hint2" }],
        [{ text: "💡💡💡 Использовал 3 подсказки", callback_data: "review_filter:hint3" }],
        [{ text: "📚 Все вопросы", callback_data: "review_filter:all" }],
      ],
    },
  };
}

module.exports = {
  introMessage,
  formatQuestion,
  formatAnswerFeedback,
  formatHintMessage,
  buildHintReplyMarkup,
  formatRevealAnswerMessage,
  formatSessionMessage,
  formatTestResult,
  formatStats,
  formatReviewMenu,
  buildReviewMenuMarkup,
  formatDailyReminder,
  buildQuestionReplyMarkup,
};
