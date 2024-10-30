const express = require("express");
const errorHandler = require("./middleware/errorHandler");
const corsMiddleware = require("./middleware/cors");
const eventRoutes = require("./routes/eventRoutes");
const verificationRoutes = require("./routes/verificationRoutes");
const { loadUnsentMessages } = require("./services/messageService");

const app = express();

app.use(express.json({
  limit: "10mb",
  verify: (req, res, buf) => {
    try {
      JSON.parse(buf);
    } catch (e) {
      res.status(400).json({ error: "Invalid JSON" });
      throw new Error("Invalid JSON");
    }
  },
}));

app.use(corsMiddleware);
app.use(errorHandler);

// Routes
app.use("/api", eventRoutes);
app.use("/api", verificationRoutes);

module.exports = app;