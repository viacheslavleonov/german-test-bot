const fs = require("fs");
const path = require("path");

const { initDb, run, get } = require("../src/db");

async function resetDatabase() {
  console.log("🧹 Clearing database...");
  await initDb();

  await run("DELETE FROM user_tests");
  console.log("  ✓ Cleared user_tests");

  await run("DELETE FROM session_question_hints");
  console.log("  ✓ Cleared session_question_hints");

  await run("DELETE FROM user_question_progress");
  console.log("  ✓ Cleared user_question_progress");

  await run("DELETE FROM user_sessions");
  console.log("  ✓ Cleared user_sessions");

  await run("DELETE FROM users");
  console.log("  ✓ Cleared users");

  await run("DELETE FROM hint_cache_levels");
  console.log("  ✓ Cleared hint_cache_levels");

  await run("DELETE FROM hint_cache");
  console.log("  ✓ Cleared hint_cache");

  await run("DELETE FROM questions");
  console.log("  ✓ Cleared questions");

  console.log("✅ Database reset complete.\n");
}

async function migrate() {
  await initDb();

  const filePath = path.join(__dirname, "..", "questions.json");
  const raw = fs.readFileSync(filePath, "utf8");
  const questions = JSON.parse(raw);

  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("questions.json is empty or invalid");
  }

  let inserted = 0;
  let skipped = 0;

  for (const item of questions) {
    if (!Array.isArray(item.options) || item.options.length !== 4) {
      skipped += 1;
      continue;
    }

    const exists = await get("SELECT id FROM questions WHERE question_number = ?", [item.question_number]);
    if (exists) {
      skipped += 1;
      continue;
    }

    await run(
      `
        INSERT INTO questions (
          question_number,
          question_text,
          option_1,
          option_2,
          option_3,
          option_4,
          correct_answer
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        item.question_number,
        item.question,
        item.options[0],
        item.options[1],
        item.options[2],
        item.options[3],
        item.answer,
      ]
    );

    inserted += 1;
  }

  console.log(`📥 Migration complete. Inserted: ${inserted}, Skipped: ${skipped}`);
}

async function main() {
  const command = process.argv[2];

  try {
    if (command === "reset") {
      await resetDatabase();
      console.log("💡 To remigrate from questions.json, run: npm run migrate");
    } else if (command === "fresh") {
      await resetDatabase();
      await migrate();
      console.log("✨ Fresh migration complete.");
    } else {
      await migrate();
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

main();
