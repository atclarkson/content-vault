const crypto = require("crypto");

function hashFile(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function md5File(buffer) {
  return crypto.createHash("md5").update(buffer).digest("hex");
}

module.exports = {
  hashFile,
  md5File,
};
