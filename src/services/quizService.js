const { all, get, run } = require("../db");
const {
  TEST_QUESTION_COUNT,
} = require("../config");
const {
  getAllQuestionIdsRandomized,
  getQuestionById,
  getQuestionOptions,
  resolveCorrectOptionIndex,
  countQuestions,
  getRandomQuestions,
  getQuestionIdsByFilter,
} = require("./questionService");

async function ensureUser(telegramUser) {
  await run(
    `
      INSERT INTO users (user_id, username, first_name, last_name)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        last_activity_at = CURRENT_TIMESTAMP
    `,
    [
      telegramUser.id,
      telegramUser.username || null,
      telegramUser.first_name || null,
      telegramUser.last_name || null,
    ]
  );
}

async function getActiveSession(userId) {
  return get(
    `
      SELECT * FROM user_sessions
      WHERE user_id = ? AND status = 'active'
      ORDER BY started_at DESC
      LIMIT 1
    `,
    [userId]
  );
}

async function startSession(userId, mode) {
  const active = await getActiveSession(userId);
  if (active) {
    return { session: active, resumed: true };
  }

  let questionIds = [];

  if (mode === "test") {
    const testQuestions = await getRandomQuestions(TEST_QUESTION_COUNT);
    questionIds = testQuestions.map((row) => row.id);
  } else {
    questionIds = await getAllQuestionIdsRandomized();
  }

  if (questionIds.length === 0) {
    throw new Error("База вопросов пуста. Сначала запусти миграцию.");
  }

  const result = await run(
    `
      INSERT INTO user_sessions (user_id, mode, question_ids, current_index, last_question_started_at)
      VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP)
    `,
    [userId, mode, JSON.stringify(questionIds)]
  );

  const session = await get("SELECT * FROM user_sessions WHERE id = ?", [result.lastID]);
  return { session, resumed: false };
}

function parseQuestionIds(session) {
  return JSON.parse(session.question_ids);
}

async function getCurrentQuestionForSession(session) {
  const questionIds = parseQuestionIds(session);
  const currentQuestionId = questionIds[session.current_index];
  if (!currentQuestionId) {
    return null;
  }
  return getQuestionById(currentQuestionId);
}

async function cancelSession(userId) {
  const session = await getActiveSession(userId);
  if (!session) {
    return false;
  }

  await run(
    `
      UPDATE user_sessions
      SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [session.id]
  );

  return true;
}

async function trackHintUsage(userId) {
  const session = await getActiveSession(userId);
  if (!session) {
    throw new Error("Нет активной сессии. Используй /learn или /test.");
  }

  const question = await getCurrentQuestionForSession(session);
  if (!question) {
    throw new Error("Не удалось загрузить текущий вопрос.");
  }

  await run(
    `
      INSERT INTO session_question_hints (session_id, question_id, hints_used)
      VALUES (?, ?, 1)
      ON CONFLICT(session_id, question_id) DO UPDATE SET
        hints_used = hints_used + 1
    `,
    [session.id, question.id]
  );

  await run(
    `
      INSERT INTO user_question_progress (user_id, question_id, times_hint_used, last_attempted_at)
      VALUES (?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, question_id) DO UPDATE SET
        times_hint_used = times_hint_used + 1,
        last_attempted_at = CURRENT_TIMESTAMP
    `,
    [userId, question.id]
  );

  await run(
    `
      UPDATE users
      SET total_hints_used = total_hints_used + 1,
          last_activity_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `,
    [userId]
  );

  await run(
    `
      UPDATE user_sessions
      SET hints_used = hints_used + 1
      WHERE user_id = ? AND status = 'active'
    `,
    [userId]
  );

  const hintRow = await get(
    `
      SELECT hints_used
      FROM session_question_hints
      WHERE session_id = ? AND question_id = ?
    `,
    [session.id, question.id]
  );

  return {
    session,
    question,
    hintLevel: hintRow ? hintRow.hints_used : 1,
  };
}

async function getSecondsSpentForSession(sessionId) {
  const timeRow = await get(
    `
      SELECT CASE
        WHEN last_question_started_at IS NULL THEN 0
        ELSE MAX(0, CAST((julianday('now') - julianday(last_question_started_at)) * 86400 AS INTEGER))
      END AS seconds_spent
      FROM user_sessions
      WHERE id = ?
    `,
    [sessionId]
  );
  return timeRow ? timeRow.seconds_spent : 0;
}

async function finalizeSessionIfNeeded(userId, session) {
  const questionIds = parseQuestionIds(session);
  const isCompleted = session.current_index >= questionIds.length;

  if (isCompleted) {
    await run(
      `
        UPDATE user_sessions
        SET status = 'completed', completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [session.id]
    );

    if (session.mode === "test") {
      const totalQuestions = questionIds.length;
      const score = totalQuestions > 0 ? (session.correct_answers / totalQuestions) * 100 : 0;

      await run(
        `
          INSERT INTO user_tests (user_id, session_id, total_questions, correct_answers, score_percentage, duration_seconds)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          userId,
          session.id,
          totalQuestions,
          session.correct_answers,
          score,
          session.total_seconds,
        ]
      );
    }
  }

  return isCompleted;
}

async function answerCurrentQuestion(userId, answerNumber) {
  const session = await getActiveSession(userId);
  if (!session) {
    throw new Error("Нет активной сессии. Используй /learn или /test.");
  }

  const question = await getCurrentQuestionForSession(session);
  if (!question) {
    throw new Error("Не удалось загрузить текущий вопрос.");
  }

  const options = getQuestionOptions(question);
  const selectedIndex = answerNumber - 1;
  const selectedOption = options[selectedIndex];
  if (!selectedOption) {
    throw new Error("Ответ должен быть числом от 1 до 4.");
  }

  const correctIndex = resolveCorrectOptionIndex(question);
  const isCorrect = selectedIndex === correctIndex;

  const secondsSpent = await getSecondsSpentForSession(session.id);

  await run(
    `
      INSERT INTO user_question_progress (user_id, question_id, times_attempted, times_correct, last_attempted_at)
      VALUES (?, ?, 1, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, question_id) DO UPDATE SET
        times_attempted = times_attempted + 1,
        times_correct = times_correct + excluded.times_correct,
        last_attempted_at = CURRENT_TIMESTAMP
    `,
    [userId, question.id, isCorrect ? 1 : 0]
  );

  if (isCorrect) {
    await run(
      `UPDATE user_question_progress SET last_correct_at = CURRENT_TIMESTAMP WHERE user_id = ? AND question_id = ?`,
      [userId, question.id]
    );
  }

  await run(
    `
      UPDATE users
      SET total_questions_seen = total_questions_seen + 1,
          correct_answers_count = correct_answers_count + ?,
          total_time_seconds = total_time_seconds + ?,
          last_activity_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `,
    [isCorrect ? 1 : 0, secondsSpent, userId]
  );

  await run(
    `
      UPDATE user_sessions
      SET current_index = current_index + 1,
          correct_answers = correct_answers + ?,
          total_seconds = total_seconds + ?,
          last_question_started_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [isCorrect ? 1 : 0, secondsSpent, session.id]
  );

  const updatedSession = await get("SELECT * FROM user_sessions WHERE id = ?", [session.id]);
  const isCompleted = await finalizeSessionIfNeeded(userId, updatedSession);

  return {
    session: updatedSession,
    isCorrect,
    correctIndex,
    correctAnswer: question.correct_answer,
    completed: isCompleted,
  };
}

async function revealCurrentAnswer(userId) {
  const session = await getActiveSession(userId);
  if (!session) {
    throw new Error("Нет активной сессии. Используй /learn или /test.");
  }

  const question = await getCurrentQuestionForSession(session);
  if (!question) {
    throw new Error("Не удалось загрузить текущий вопрос.");
  }

  const correctIndex = resolveCorrectOptionIndex(question);
  const secondsSpent = await getSecondsSpentForSession(session.id);

  await run(
    `
      INSERT INTO user_question_progress (user_id, question_id, times_attempted, times_correct, last_attempted_at)
      VALUES (?, ?, 1, 0, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, question_id) DO UPDATE SET
        times_attempted = times_attempted + 1,
        last_attempted_at = CURRENT_TIMESTAMP
    `,
    [userId, question.id]
  );

  await run(
    `
      UPDATE users
      SET total_questions_seen = total_questions_seen + 1,
          total_time_seconds = total_time_seconds + ?,
          last_activity_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `,
    [secondsSpent, userId]
  );

  await run(
    `
      UPDATE user_sessions
      SET current_index = current_index + 1,
          total_seconds = total_seconds + ?,
          last_question_started_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [secondsSpent, session.id]
  );

  const updatedSession = await get("SELECT * FROM user_sessions WHERE id = ?", [session.id]);
  const isCompleted = await finalizeSessionIfNeeded(userId, updatedSession);

  return {
    session: updatedSession,
    completed: isCompleted,
    correctIndex,
    correctAnswer: question.correct_answer,
  };
}

async function startFilteredSession(userId, filter) {
  // Cancel any active session first
  await cancelSession(userId);

  const questionIds = await getQuestionIdsByFilter(userId, filter);

  if (questionIds.length === 0) {
    return { isEmpty: true, session: null };
  }

  const result = await run(
    `
      INSERT INTO user_sessions (user_id, mode, question_ids, current_index, last_question_started_at)
      VALUES (?, 'learning', ?, 0, CURRENT_TIMESTAMP)
    `,
    [userId, JSON.stringify(questionIds)]
  );

  const session = await get("SELECT * FROM user_sessions WHERE id = ?", [result.lastID]);
  return { isEmpty: false, session };
}

async function getStats(userId) {
  const base = await get(
    `
      SELECT total_questions_seen, correct_answers_count, total_hints_used, total_time_seconds
      FROM users
      WHERE user_id = ?
    `,
    [userId]
  );

  if (!base) {
    return {
      totalQuestionsSeen: 0,
      correctAnswersCount: 0,
      totalHintsUsed: 0,
      totalTimeSeconds: 0,
      lastTests: [],
    };
  }

  const lastTests = await all(
    `
      SELECT completed_at, total_questions, correct_answers, score_percentage, duration_seconds
      FROM user_tests
      WHERE user_id = ?
      ORDER BY completed_at DESC
      LIMIT 5
    `,
    [userId]
  );

  return {
    totalQuestionsSeen: base.total_questions_seen,
    correctAnswersCount: base.correct_answers_count,
    totalHintsUsed: base.total_hints_used,
    totalTimeSeconds: base.total_time_seconds,
    lastTests,
  };
}

async function getSessionQuestionCount(session) {
  const ids = parseQuestionIds(session);
  return ids.length;
}

async function hasAnyQuestions() {
  const total = await countQuestions();
  return total > 0;
}

module.exports = {
  ensureUser,
  getActiveSession,
  startSession,
  startFilteredSession,
  getCurrentQuestionForSession,
  cancelSession,
  trackHintUsage,
  answerCurrentQuestion,
  revealCurrentAnswer,
  getStats,
  getSessionQuestionCount,
  hasAnyQuestions,
};
