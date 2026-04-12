const { all, get } = require("../db");

async function countQuestions() {
  const row = await get("SELECT COUNT(*) AS total FROM questions");
  return row ? row.total : 0;
}

async function getRandomQuestions(limit) {
  return all(
    `
      SELECT id, question_number, question_text, option_1, option_2, option_3, option_4, correct_answer
      FROM questions
      ORDER BY RANDOM()
      LIMIT ?
    `,
    [limit]
  );
}

async function getQuestionById(questionId) {
  return get(
    `
      SELECT id, question_number, question_text, option_1, option_2, option_3, option_4, correct_answer
      FROM questions
      WHERE id = ?
    `,
    [questionId]
  );
}

async function getAllQuestionIdsRandomized() {
  const rows = await all("SELECT id FROM questions ORDER BY RANDOM()");
  return rows.map((row) => row.id);
}

function getQuestionOptions(question) {
  return [question.option_1, question.option_2, question.option_3, question.option_4];
}

function resolveCorrectOptionIndex(question) {
  const options = getQuestionOptions(question);
  const normalizedAnswer = question.correct_answer.trim();
  return options.findIndex((option) => option.trim() === normalizedAnswer);
}

async function getQuestionIdsByFilter(userId, filter) {
  if (filter === "wrong") {
    // Only include questions where the last attempt was wrong
    // (last_correct_at is null or older than last_attempted_at)
    const rows = await all(
      `
        SELECT question_id FROM user_question_progress
        WHERE user_id = ?
          AND times_attempted > times_correct
          AND (last_correct_at IS NULL OR last_correct_at < last_attempted_at)
        ORDER BY RANDOM()
      `,
      [userId]
    );
    return rows.map((r) => r.question_id);
  }

  const minHintLevel = { hint1: 1, hint2: 2, hint3: 3 }[filter];
  if (minHintLevel !== undefined) {
    // Include questions where hints were used AND the user hasn't answered correctly
    // more recently than the last hint session (i.e., not yet mastered)
    const rows = await all(
      `
        SELECT sqh.question_id
        FROM session_question_hints sqh
        JOIN user_sessions us ON sqh.session_id = us.id
        WHERE us.user_id = ?
        GROUP BY sqh.question_id
        HAVING MAX(sqh.hints_used) >= ?
          AND (
            (SELECT last_correct_at FROM user_question_progress
             WHERE user_id = ? AND question_id = sqh.question_id) IS NULL
            OR MAX(us.started_at) > (SELECT last_correct_at FROM user_question_progress
                                     WHERE user_id = ? AND question_id = sqh.question_id)
          )
        ORDER BY RANDOM()
      `,
      [userId, minHintLevel, userId, userId]
    );
    return rows.map((r) => r.question_id);
  }

  // 'all' or unknown filter
  return getAllQuestionIdsRandomized();
}

module.exports = {
  countQuestions,
  getRandomQuestions,
  getQuestionById,
  getAllQuestionIdsRandomized,
  getQuestionOptions,
  resolveCorrectOptionIndex,
  getQuestionIdsByFilter,
};
