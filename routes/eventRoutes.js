const express = require("express");
const router = express.Router();
const { getCairoNow, parseDate } = require("../utils/dateUtils");
const {
  sendMessage,
  storeMessage,
  scheduleMessage,
} = require("../services/messageService");
const { updateEvent } = require("../services/eventService");

router.post("/event", async (req, res) => {
  console.log("\nReceived event data:", req.body);

  const { date, id: eventId, message } = req.body;

  if (!date || !eventId || !message) {
    return res.status(400).json({
      error: "Missing required fields",
      required: ["date", "id", "message"],
      received: { date, eventId, message },
    });
  }

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

    // Store the message first
    const messageId = await storeMessage(message, eventId, normalizedDate);

    // Check if the date is in the past
    if (parsedDate.isBefore(currentDate)) {
      console.log("Date is in the past, sending immediately...");
      try {
        await sendMessage(messageId, eventId, message);
        await updateEvent(eventId, messageId);
        return res.json({
          success: true,
          message: "Message sent immediately",
          messageId,
          originalDate: date,
          normalizedDate: normalizedDate,
          timezone: TIMEZONE,
          sentImmediately: true,
        });
      } catch (sendError) {
        return res.status(500).json({
          error: "Failed to send message immediately",
          details: sendError.message,
          messageId,
        });
      }
    }

    // If date is in the future, schedule it
    scheduleMessage(messageId, eventId, message, normalizedDate);

    // Update the event with the new message ID
    await updateEvent(eventId, messageId);

    res.json({
      success: true,
      message: "Event scheduled successfully",
      scheduledFor: parsedDate.format(),
      messageId,
      originalDate: date,
      normalizedDate: normalizedDate,
      timezone: TIMEZONE,
      sentImmediately: false,
    });
  } catch (error) {
    console.error("Error handling event:", error);
    res.status(500).json({
      error: "Failed to process event",
      details: error.message,
    });
  }
});

module.exports = router;
