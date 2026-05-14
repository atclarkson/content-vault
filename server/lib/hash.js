const crypto = require("crypto");

function hashFile(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

module.exports = hashFile;
