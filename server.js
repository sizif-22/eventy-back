require("dotenv").config();
const express = require("express");
const { initializeApp } = require("firebase/app");
const {
  getFirestore,
  doc,
  getDoc,
  collection,
  getDocs,
  addDoc,
  updateDoc,
  query,
  where,
  Timestamp,
} = require("firebase/firestore");
const nodemailer = require("nodemailer");
const cron = require("node-cron");

// Add moment-timezone for better timezone handling
const moment = require('moment-timezone');
const TIMEZONE = 'Africa/Cairo';

const app = express();

// Rest of the middleware remains the same...
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

// Error handling middleware
app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Request entity too large" });
  }
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "Invalid JSON format" });
  }
  console.error("Unexpected error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// CORS middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  if (req.method === "OPTIONS") {
    res.header(
      "Access-Control-Allow-Methods",
      "POST, GET, PUT, DELETE, OPTIONS"
    );
    return res.status(200).send();
  }
  next();
});

// Debug middleware
app.use((req, res, next) => {
  if (req.path === "/api/event") {
    console.log("=== Request Debug Info ===");
    console.log("Method:", req.method);
    console.log("URL:", req.url);
    console.log("Headers:", JSON.stringify(req.headers, null, 2));
    console.log("Body:", JSON.stringify(req.body, null, 2));
  }
  next();
});

// Firebase configuration remains the same...
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.STORAGE_BUCKET,
  messagingSenderId: process.env.MESSAGING_SENDER_ID,
  appId: process.env.APP_ID,
  measurementId: process.env.MEASUREMENT_ID,
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const activeJobs = new Map();

// Email transporter setup remains the same...
let transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Updated date handling functions
function isValidDate(dateString) {
  try {
    const cairoDate = moment.tz(dateString, TIMEZONE);
    const now = moment.tz(TIMEZONE);
    return cairoDate.isValid() && cairoDate.isAfter(now);
  } catch (error) {
    return false;
  }
}

function normalizeDate(dateString) {
  // Convert to Cairo timezone then get ISO string
  return moment.tz(dateString, TIMEZONE).toISOString();
}

function getCairoNow() {
  return moment.tz(TIMEZONE);
}

function convertToCronExpression(dateString) {
  const cairoDate = moment.tz(dateString, TIMEZONE);
  return `${cairoDate.minutes()} ${cairoDate.hours()} ${cairoDate.date()} ${cairoDate.month() + 1} *`;
}

// Updated message handling functions
async function sendMessage(messageId, eventId, content) {
  try {
    const eventDoc = await getDoc(doc(db, "events", eventId));
    if (!eventDoc.exists()) {
      throw new Error(`Event ${eventId} not found`);
    }

    const eventData = eventDoc.data();
    
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: eventData.email,
      subject: "Scheduled Message",
      text: content,
    });

    const messageRef = doc(db, "messages", messageId);
    await updateDoc(messageRef, {
      sent: true,
      sentAt: Timestamp.now(),
    });

    console.log(`Message ${messageId} sent successfully at ${moment.tz(TIMEZONE).format()}`);
    
    if (activeJobs.has(messageId)) {
      activeJobs.get(messageId).stop();
      activeJobs.delete(messageId);
    }
  } catch (error) {
    console.error(`Error sending message ${messageId}:`, error);
    throw error;
  }
}

function scheduleMessage(messageId, eventId, content, date) {
  const cairoDate = moment.tz(date, TIMEZONE);
  const cronExpression = convertToCronExpression(date);

  console.log(`Scheduling message ${messageId} for ${cairoDate.format()} (${cronExpression})`);

  if (activeJobs.has(messageId)) {
    activeJobs.get(messageId).stop();
  }

  const job = cron.schedule(cronExpression, async () => {
    try {
      await sendMessage(messageId, eventId, content);
    } catch (error) {
      console.error(`Failed to send scheduled message ${messageId}:`, error);
    }
  }, {
    scheduled: true,
    timezone: TIMEZONE
  });

  activeJobs.set(messageId, job);
}

async function handleMissedMessages(messages) {
  for (const doc of messages) {
    const messageData = doc.data();
    try {
      await sendMessage(doc.id, messageData.eventId, messageData.content);
      console.log(`Processed missed message ${doc.id}`);
    } catch (error) {
      console.error(`Failed to process missed message ${doc.id}:`, error);
    }
  }
}

async function loadUnsentMessages() {
  try {
    const messagesRef = collection(db, "messages");
    const q = query(messagesRef, where("sent", "==", false));
    const querySnapshot = await getDocs(q);

    console.log(`Found ${querySnapshot.size} unsent messages`);

    const now = getCairoNow();
    const futureMessages = [];
    const missedMessages = [];

    querySnapshot.forEach((doc) => {
      const messageData = doc.data();
      const messageDate = moment.tz(
        messageData.date instanceof Timestamp
          ? messageData.date.toDate()
          : messageData.date,
        TIMEZONE
      );

      console.log(`\nProcessing message ${doc.id}:`);
      console.log("Message date (Cairo):", messageDate.format());
      console.log("Current time (Cairo):", now.format());
      console.log(
        "Time difference (minutes):",
        messageDate.diff(now, 'minutes')
      );
      console.log("Is future?", messageDate.isAfter(now));

      if (messageDate.isAfter(now)) {
        console.log(
          `Scheduling future message: ${doc.id} for ${messageDate.format()}`
        );
        futureMessages.push(doc);
      } else {
        console.log(
          `Found missed message: ${doc.id} scheduled for ${messageDate.format()}`
        );
        missedMessages.push(doc);
      }
    });

    if (missedMessages.length > 0) {
      console.log(
        `\nProcessing ${missedMessages.length} missed messages from downtime...`
      );
      await handleMissedMessages(missedMessages);
    }

    console.log(`\nScheduling ${futureMessages.length} future messages...`);
    futureMessages.forEach((doc) => {
      const messageData = doc.data();
      const messageDate = moment.tz(
        messageData.date instanceof Timestamp
          ? messageData.date.toDate()
          : messageData.date,
        TIMEZONE
      );

      scheduleMessage(
        doc.id,
        messageData.eventId,
        messageData.content,
        messageDate
      );
    });

    console.log(
      `\nProcessed ${querySnapshot.size} total messages (${futureMessages.length} scheduled, ${missedMessages.length} missed)`
    );
  } catch (error) {
    console.error("Error loading unsent messages:", error);
    console.error("Error details:", error.stack);
  }
}

async function storeMessage(message, eventId, date) {
  try {
    const cairoDate = moment.tz(date, TIMEZONE);

    const messageData = {
      content: message,
      eventId: eventId,
      date: Timestamp.fromDate(cairoDate.toDate()),
      sent: false,
      createdAt: Timestamp.now(),
      originalDateString: date,
      normalizedDate: cairoDate.toISOString(),
      missedDuringDowntime: false,
    };

    const messagesRef = collection(db, "messages");
    const docRef = await addDoc(messagesRef, messageData);
    console.log("Message stored with ID:", docRef.id);
    return docRef.id;
  } catch (error) {
    console.error("Error storing message:", error);
    throw error;
  }
}

app.post("/api/event", async (req, res) => {
  console.log("\nReceived event data:", req.body);

  const { date, id, message } = req.body;

  if (!date || !id || !message) {
    return res.status(400).json({
      error: "Missing required fields",
      required: ["date", "id", "message"],
      received: { date, id, message },
    });
  }

  try {
    console.log("Validating date:", date);
    const cairoDate = moment.tz(date, TIMEZONE);
    const currentDate = moment.tz(TIMEZONE);
    console.log("Parsed date (Cairo):", cairoDate.format());
    console.log("Current date (Cairo):", currentDate.format());
    console.log("Is valid?:", cairoDate.isValid());
    console.log("Is future?:", cairoDate.isAfter(currentDate));

    if (!isValidDate(date)) {
      return res.status(400).json({
        error: "Invalid date format or past date",
        received: date,
        parsedAs: cairoDate.format(),
        currentTime: currentDate.format(),
        requirements: [
          "Date must be in a valid format (e.g., YYYY-MM-DDTHH:mm:ss)",
          "Date must be in the future",
          "Example: 2024-10-20T01:23:00",
        ],
      });
    }

    console.log("Normalizing date:", date);
    const normalizedDate = normalizeDate(date);
    console.log("Normalized to:", normalizedDate);

    const messageId = await storeMessage(message, id, normalizedDate);
    scheduleMessage(messageId, id, message, normalizedDate);

    res.json({
      success: true,
      message: "Event scheduled successfully",
      scheduledFor: cairoDate.format(),
      messageId,
      originalDate: date,
      normalizedDate: normalizedDate,
    });
  } catch (error) {
    console.error("Error scheduling event:", error);
    res.status(500).json({
      error: "Failed to schedule event",
      details: error.message,
    });
  }
});

// Server startup and error handling remains the same...
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
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