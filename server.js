
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const publicDirectory = path.join(__dirname, "public");

app.disable("x-powered-by");

app.use(express.static(publicDirectory, {
  extensions: ["html"],
  maxAge: "1h"
}));

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    application: "Advanced Image Studio"
  });
});

app.get(/.*/, (req, res, next) => {
  if (req.method !== "GET") return next();

  res.sendFile(path.join(publicDirectory, "index.html"), (error) => {
    if (error) next(error);
  });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).send("An unexpected server error occurred.");
});

app.listen(PORT, () => {
  console.log("------------------------------------------");
  console.log("      ADVANCED IMAGE STUDIO");
  console.log("------------------------------------------");
  console.log(`Open: http://localhost:${PORT}`);
  console.log("Press Ctrl+C to stop the server.");
});
