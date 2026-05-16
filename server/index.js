const path = require("path");
const express = require("express");
const { initializeDatabase } = require("./lib/db");
require("dotenv").config();

const app = express();
const port = Number(process.env.PORT) || 3000;
const clientDistPath = path.join(__dirname, "..", "client", "dist");

initializeDatabase();

app.use(express.json());

// API routes
app.get("/api/health", (req, res) => {
  res.json({ data: { status: "ok", app: "content-vault" } });
});
app.use("/api/photos", require("./routes/photos"));
app.use("/api/upload", require("./routes/upload"));
app.use("/api/people", require("./routes/people"));
app.use("/api/tags", require("./routes/tags"));
app.use("/api/tag-groups", require("./routes/tag-groups"));
app.use("/api/export", require("./routes/export"));
app.use("/api/caption", require("./routes/caption"));
app.use("/api/destinations", require("./routes/destinations"));
app.use("/api/videos", require("./routes/videos"));
app.use("/api/settings", require("./routes/settings"));
app.use("/api/processing", require("./routes/processing"));
app.use("/api/reconcile", require("./routes/reconcile"));

// Serve React frontend (Phase 4 — client/dist won't exist until then)
app.use(express.static(clientDistPath));
app.get("*", (req, res) => {
  res.sendFile(path.join(clientDistPath, "index.html"), (error) => {
    if (!error) return;
    res.status(404).json({ error: "Client build not found" });
  });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`content-vault server running at http://localhost:${port}`);
});
