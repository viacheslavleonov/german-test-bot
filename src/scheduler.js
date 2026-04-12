const cron = require("node-cron");
const { ALLOWED_TELEGRAM_USERS, REMINDER_TIME } = require("./config");
const { getActiveSession } = require("./services/quizService");
const { formatDailyReminder } = require("./utils/messages");

function registerScheduler(bot) {
  // Every day at 20:00 local time
  cron.schedule(REMINDER_TIME, async () => {
    for (const userId of ALLOWED_TELEGRAM_USERS) {
      try {
        const session = await getActiveSession(userId);
        await bot.sendMessage(userId, formatDailyReminder(session));
      } catch (error) {
        console.error(`[scheduler] Failed to send reminder to ${userId}:`, error.message);
      }
    }
  });

  console.log(`Daily reminder scheduled: ${REMINDER_TIME}.`);
}

module.exports = { registerScheduler };
