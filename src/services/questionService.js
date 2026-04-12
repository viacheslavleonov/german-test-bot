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

module.exports = {
  countQuestions,
  getRandomQuestions,
  getQuestionById,
  getAllQuestionIdsRandomized,
  getQuestionOptions,
  resolveCorrectOptionIndex,
};
