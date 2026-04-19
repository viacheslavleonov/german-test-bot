const cron = require("node-cron");
const { all } = require("./db");
const { getActiveSession } = require("./services/quizService");
const { formatDailyReminder } = require("./utils/messages");

function registerScheduler(bot) {
  // Check every minute for users whose reminder_time matches current HH:MM
  cron.schedule("* * * * *", async () => {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const users = await all(
      "SELECT user_id FROM users WHERE reminder_time = ?",
      [currentTime]
    );

    for (const { user_id } of users) {
      try {
        const session = await getActiveSession(user_id);
        await bot.sendMessage(user_id, formatDailyReminder(session));
      } catch (error) {
        console.error(`[scheduler] Failed to send reminder to ${user_id}:`, error.message);
      }
    }
  });

  console.log(`Reminder scheduler active (TZ: ${process.env.TZ || "system default"}, now: ${new Date().toLocaleString()}).`);
}

module.exports = { registerScheduler };
