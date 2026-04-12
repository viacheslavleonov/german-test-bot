const fs = require("fs");
const path = require("path");

const IMAGES_DIR = path.join(__dirname, "..", "..", "images");

function getImagePathForQuestion(questionNumber) {
  const imagePath = path.join(IMAGES_DIR, `${questionNumber}.png`);
  if (fs.existsSync(imagePath)) {
    return imagePath;
  }
  return null;
}

module.exports = {
  getImagePathForQuestion,
};
