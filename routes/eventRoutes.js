const express = require("express");
const router = express.Router();
const { getCairoNow, parseDate } = require("../utils/dateUtils");
const {
  sendMessage,
  storeMessage,
  scheduleMessage,
} = require("../services/messageService");
const { updateEvent } = require("../services/eventService");

// Define constants
const TIMEZONE = process.env.TIMEZONE || "Africa/Cairo";
const MAX_MESSAGE_LENGTH = 1000; // Example limit

// Validation middleware
const validateEventRequest = (req, res, next) => {
  const { date, id: eventId, message } = req.body;

  if (!date || !eventId || !message) {
    return res.status(400).json({
      error: "Missing required fields",
      required: ["date", "id", "message"],
      received: { date, eventId, message },
    });
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({
      error: "Message too long",
      maxLength: MAX_MESSAGE_LENGTH,
      receivedLength: message.length,
    });
  }

  next();
};

router.post("/event", validateEventRequest, async (req, res) => {
  console.log("\nReceived event data:", req.body);
  const { date, id: eventId, message } = req.body;

  try {
    console.log("Validating date:", date);
    const parsedDate = parseDate(date);
    const currentDate = getCairoNow();

    if (!parsedDate.isValid()) {
      return res.status(400).json({
        error: "Invalid date format",
        received: date,
        parsedAs: parsedDate.format(),
        currentTime: currentDate.format(),
        timezone: TIMEZONE,
      });
    }

    const normalizedDate = parsedDate.format();

    try {
      // Use a transaction or atomic operation if your database supports it
      const messageId = await storeMessage(message, eventId, normalizedDate);
      await updateEvent(eventId, messageId);

      // Check if the date is in the past
      if (parsedDate.isBefore(currentDate)) {
        console.log("Date is in the past, sending immediately...");
        try {
          await sendMessage(messageId, eventId, message);
          return res.json({
            success: true,
            message: "Message sent immediately",
            messageId,
            originalDate: date,
            normalizedDate,
            timezone: TIMEZONE,
            sentImmediately: true,
          });
        } catch (sendError) {
          // Log the error but don't expose internal error details to client
          console.error("Failed to send message:", sendError);
          return res.status(500).json({
            error: "Failed to send message immediately",
            messageId,
          });
        }
      }

      // If date is in the future, schedule it
      try {
        await scheduleMessage(messageId, eventId, message, normalizedDate);
        res.json({
          success: true,
          message: "Event scheduled successfully",
          scheduledFor: parsedDate.format(),
          messageId,
          originalDate: date,
          normalizedDate,
          timezone: TIMEZONE,
          sentImmediately: false,
        });
      } catch (scheduleError) {
        console.error("Failed to schedule message:", scheduleError);
        return res.status(500).json({
          error: "Failed to schedule message",
          messageId,
        });
      }
    } catch (dbError) {
      console.error("Database operation failed:", dbError);
      return res.status(500).json({
        error: "Failed to process event",
        details: "Database operation failed",
      });
    }
  } catch (error) {
    console.error("Error handling event:", error);
    res.status(500).json({
      error: "Failed to process event",
      details: "Internal server error",
    });
  }
});

router.get("/test", (req, res) => {
  res.status(200).json({
    message: "it Works",
  });
});


module.exports = router;