const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const { OPENAI_API_KEY, OPENAI_MODEL } = require("../config");
const { get, run } = require("../db");

const promptPath = path.join(__dirname, "..", "..", "llm-prompt.md");
const SYSTEM_PROMPT = fs.existsSync(promptPath)
  ? fs.readFileSync(promptPath, "utf8")
  : "Ты помощник для подготовки к тесту на гражданство Германии. Отвечай только на русском языке.";
const REGENERATE_MODEL = "gpt-5.4";

const client = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

function buildContextBlock(question, mode) {
  return [
    `Режим: ${mode === "test" ? "тест" : "обучение"}`,
    `Номер вопроса: ${question.question_number}`,
    `Вопрос: ${question.question_text}`,
    "Варианты:",
    `1) ${question.option_1}`,
    `2) ${question.option_2}`,
    `3) ${question.option_3}`,
    `4) ${question.option_4}`,
  ].join("\n");
}

async function requestModel(messages, maxOutputTokens = 300, modelName = OPENAI_MODEL) {
  if (!client) {
    throw new Error("OPENAI_API_KEY не задан. Добавь ключ в .env");
  }

  const response = await client.responses.create({
    model: modelName,
    input: messages,
    max_output_tokens: maxOutputTokens,
  });

  return response.output_text || "Не удалось получить ответ от LLM.";
}

function buildHintInstructionByLevel(level) {
  if (level <= 1) {
    return [
      "Уровень подсказки 1 (минимальный).",
      "Сделай только легкую подсказку: перепиши оригинальный немецкий вопрос и вставь перевод сразу после ключевого немецкого слова: Wort (перевод).",
      "КРИТИЧНО: перевод должен стоять в середине той же фразы сразу после слова, а НЕ в конце строки и НЕ отдельным списком 'ключевые слова'.",
      "Правило количества ключевых слов:",
      "- если вопрос/вариант короткий: переводи только 1 важное слово;",
      "- если длинный: переводи 1-3 важных слова (не больше 3).",
      "Добавь краткие подсказки по вариантам ответа в inline-формате: для каждого варианта переведи только 1 слово (короткий вариант) или 1-3 слова (длинный).",
      "Не указывай правильный ответ и не ранжируй варианты по вероятности.",
      "Формат строго: 1 строка с вопросом (inline-вставки) + 4 строки вариантов 1)...4) с inline-вставками.",
    ].join("\n");
  }

  if (level === 2) {
    return [
      "Уровень подсказки 2 (средний).",
      "Дай более полезное объяснение смысла вопроса и как мыслить при выборе ответа.",
      "Можно перевести несколько ключевых слов на русский.",
      "Добавь комментарий по каждому варианту (1 короткая строка на вариант): что он означает или на что намекает.",
      "Не называй правильный вариант напрямую.",
      "Формат: 2-3 коротких предложения + блок по вариантам 1-4.",
    ].join("\n");
  }

  return [
    "Уровень подсказки 3 (предпоследний).",
    "Сделай полный перевод вопроса на русский язык.",
    "Дай полный перевод каждого варианта ответа на русский язык.",
    "Можно добавить одно короткое пояснение, но не называй правильный вариант напрямую.",
    "Формат: перевод вопроса + 'Перевод вариантов: 1)... 2)... 3)... 4)...'.",
  ].join("\n");
}

async function getHint(question, mode = "learning", hintLevel = 1) {
  const normalizedLevel = Math.min(Math.max(Number(hintLevel) || 1, 1), 3);
  const cached = await get(
    "SELECT hint_text FROM hint_cache_levels WHERE question_id = ? AND hint_level = ?",
    [question.id, normalizedLevel]
  );
  if (cached) {
    return cached.hint_text;
  }

  const userPrompt = [
    buildHintInstructionByLevel(normalizedLevel),
    "",
    buildContextBlock(question, mode),
  ].join("\n");

  const hint = await requestModel(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    320,
    OPENAI_MODEL
  );

  await run(
    `
      INSERT INTO hint_cache_levels (question_id, hint_level, hint_text, model)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(question_id, hint_level) DO UPDATE SET
        hint_text = excluded.hint_text,
        model = excluded.model,
        generated_at = CURRENT_TIMESTAMP
    `,
    [question.id, normalizedLevel, hint.trim(), OPENAI_MODEL]
  );

  return hint.trim();
}

async function regenerateHint(question, mode = "learning", hintLevel = 1) {
  const normalizedLevel = Math.min(Math.max(Number(hintLevel) || 1, 1), 3);

  const userPrompt = [
    buildHintInstructionByLevel(normalizedLevel),
    "",
    buildContextBlock(question, mode),
  ].join("\n");

  const hint = await requestModel(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    320,
    REGENERATE_MODEL
  );

  await run(
    `
      INSERT INTO hint_cache_levels (question_id, hint_level, hint_text, model)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(question_id, hint_level) DO UPDATE SET
        hint_text = excluded.hint_text,
        model = excluded.model,
        generated_at = CURRENT_TIMESTAMP
    `,
    [question.id, normalizedLevel, hint.trim(), REGENERATE_MODEL]
  );

  return hint.trim();
}

async function answerFreeform(userText, question, mode) {
  const userPrompt = [
    "Пользователь задает уточняющий вопрос по текущему заданию.",
    "Помоги понять формулировку и варианты.",
    "Если режим теста, не раскрывай ответ напрямую.",
    "Отвечай кратко и только на русском.",
    "",
    buildContextBlock(question, mode),
    "",
    `Сообщение пользователя: ${userText}`,
  ].join("\n");

  const answer = await requestModel(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    350
  );

  return answer.trim();
}

module.exports = {
  getHint,
  regenerateHint,
  answerFreeform,
};
