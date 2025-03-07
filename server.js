const app = require("./app");
const { TIMEZONE } = require("./utils/dateUtils");
const { loadUnsentMessages } = require("./services/messageService");

console.log("env vars: ", process.env.PORT);
console.log("env vars: ", process.env.PORT);
console.log("env vars: ", process.env.PORT);

const PORT = process.env.PORT || 3000;
// const PORT = 3000;

const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Using timezone: ${TIMEZONE}`);
  loadUnsentMessages().catch(console.error);
});

server.on("error", (error) => {
  console.error("Server error:", error);
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use`);
    process.exit(1);
  }
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});
