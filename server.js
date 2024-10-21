// require('dotenv').config();
// const express = require('express');
// const { initializeApp } = require('firebase/app');
// const { getFirestore, doc, getDoc, collection, getDocs } = require('firebase/firestore');
// const nodemailer = require('nodemailer');
// const cron = require('node-cron');

// const app = express();
// app.use(express.json());

// // Firebase configuration
// const firebaseConfig = {
//   apiKey: process.env.FIREBASE_API_KEY,
//   authDomain: process.env.FIREBASE_AUTH_DOMAIN,
//   projectId: process.env.FIREBASE_PROJECT_ID,
//   storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
//   messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
//   appId: process.env.FIREBASE_APP_ID,
//   measurementId: process.env.FIREBASE_MEASUREMENT_ID
// };

// // Initialize Firebase
// const firebaseApp = initializeApp(firebaseConfig);
// const db = getFirestore(firebaseApp);

// // Create a transporter using SMTP
// let transporter = nodemailer.createTransport({
//   host: process.env.SMTP_HOST, // Should be 'smtp.gmail.com'
//   port: process.env.SMTP_PORT, // Should be 587
//   secure: false, // Use TLS
//   auth: {
//     user: process.env.SMTP_USER, // Your Gmail address
//     pass: process.env.SMTP_PASS, // Your app password
//   },
// });

// // Function to convert Date to cron expression
// function dateToCron(date) {
//   const minutes = date.getUTCMinutes();
//   const hours = date.getUTCHours();
//   const dayOfMonth = date.getUTCDate();
//   const month = date.getUTCMonth() + 1;
//   return `${minutes} ${hours} ${dayOfMonth} ${month} *`;
// }

// // Function to fetch emails and send messages
// async function fetchEmailsAndSendMessages(id, message) {
//   console.log(`Fetching document with id: ${id} at ${new Date().toISOString()}`);
//   try {
//     const docRef = doc(db, 'events', id);
//     const docSnap = await getDoc(docRef);

//     if (docSnap.exists()) {
//       const joinedCollectionRef = collection(docRef, 'joined');
//       const joinedDocs = await getDocs(joinedCollectionRef);

//       const emails = [];
//       joinedDocs.forEach((joinedDoc) => {
//         const data = joinedDoc.data();
//         if (data['0']) {
//           emails.push(data['0']);  // The email is directly in the '0' field
//         }
//       });

//       console.log('Collected emails:', emails);

//       // Send emails to all collected email addresses
//       for (const email of emails) {
//         await sendEmail(email, message);
//       }
//     } else {
//       console.log(`No document found with id: ${id}`);
//     }
//   } catch (error) {
//     console.error('Error fetching document or sending messages:', error);
//   }
// }

// // Function to send email
// async function sendEmail(email, message) {
//   try {
//     let info = await transporter.sendMail({
//       from: 'hello@web-events-two.vercel.app',
//       to: email,
//       subject: "Event Notification",
//       text: message,
//       html: `<p>${message}</p>`,
//     });

//     console.log('Message sent: %s', info.messageId);
//   } catch (error) {
//     console.error('Error sending email to', email, ':', error.message);
//     // Optionally, you can add retry logic or notify the user/admin
//   }
// }

// app.post('/api/event', (req, res) => {
//   const { date, id, message } = req.body;

//   console.log('Received event data:', req.body);

//   if (!date || !id || !message) {
//     return res.status(400).json({ error: 'Missing required fields' });
//   }

//   const eventDate = new Date(date + 'Z');

//   console.log('Parsed event date:', eventDate);

//   if (isNaN(eventDate.getTime())) {
//     return res.status(400).json({ error: 'Invalid date format' });
//   }

//   const cronExpression = dateToCron(eventDate);
//   console.log(`Scheduled job for: ${eventDate.toISOString()}`);
//   console.log('Cron expression:', cronExpression);

//   if (!cron.validate(cronExpression)) {
//     return res.status(400).json({ error: 'Invalid cron expression generated' });
//   }

//   const task = cron.schedule(cronExpression, () => {
//     console.log(`Executing scheduled task at ${new Date().toISOString()}`);
//     fetchEmailsAndSendMessages(id, message);
//   }, {
//     scheduled: true,
//     timezone: "Africa/Cairo"
//   });

//   task.start();

//   console.log(`Scheduled job set for: ${eventDate.toISOString()}`);
//   res.json({
//     success: true,
//     message: 'Event scheduled successfully',
//     scheduledFor: eventDate.toISOString(),
//     cronExpression
//   });
// });

// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => {
//   console.log(`Server is running on port ${PORT}`);
// });
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
const moment = require("moment-timezone");

const TIMEZONE = "Africa/Cairo";
moment.tz.setDefault(TIMEZONE);

const app = express();

// Middleware setup
app.use(
  express.json({
    limit: "10mb",
    verify: (req, res, buf) => {
      try {
        JSON.parse(buf);
      } catch (e) {
        res.status(400).json({ error: "Invalid JSON" });
        throw new Error("Invalid JSON");
      }
    },
  })
);

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

// Firebase configuration
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
  measurementId: process.env.FIREBASE_MEASUREMENT_ID,
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const activeJobs = new Map();

// Email transporter setup
let transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Helper functions for date handling
function parseDate(dateString) {
  let parsed = moment.tz(dateString, TIMEZONE);

  if (!parsed.isValid()) {
    const formats = [
      "YYYY-MM-DD HH:mm:ss",
      "YYYY-MM-DDTHH:mm:ss",
      "YYYY-MM-DD HH:mm",
      "DD-MM-YYYY HH:mm:ss",
      "DD/MM/YYYY HH:mm:ss",
    ];
    parsed = moment.tz(dateString, formats, TIMEZONE);
  }

  return parsed;
}

function getCairoNow() {
  return moment().tz(TIMEZONE);
}

function convertToCronExpression(dateString) {
  const parsed = parseDate(dateString);
  if (!parsed.isValid()) {
    throw new Error("Invalid date for cron expression");
  }
  return `${parsed.minutes()} ${parsed.hours()} ${parsed.date()} ${
    parsed.month() + 1
  } *`;
}

// Message handling functions
async function sendMessage(messageId, eventId, content) {
  try {
    // First check if event exists
    const eventDoc = await getDoc(doc(db, "events", eventId));
    if (!eventDoc.exists()) {
      throw new Error(`Event ${eventId} not found`);
    }

    // Get all documents from the joined collection
    const joinedCollectionRef = collection(
      doc(db, "events", eventId),
      "joined"
    );
    const joinedSnapshot = await getDocs(joinedCollectionRef);

    const emails = [];
    joinedSnapshot.forEach((joinedDoc) => {
      // Get email from field "0" which contains the email address
      const participantData = joinedDoc.data();
      if (participantData["0"]) {
        emails.push(participantData["0"]);
      }
    });

    if (emails.length === 0) {
      throw new Error(`No participants found for event ${eventId}`);
    }

    console.log(`Sending emails to ${emails.length} participants:`, emails);

    // Send email to all participants
    for (const email of emails) {
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || "hello@web-events-two.vercel.app",
        to: email,
        subject: "Event Notification",
        text: content,
        html: `<p>${content}</p>`,
      });
      console.log(`Email sent successfully to ${email}`);
    }

    // Update message status
    const messageRef = doc(db, "messages", messageId);
    await updateDoc(messageRef, {
      sent: true,
      sentAt: Timestamp.now(),
      recipientCount: emails.length,
      recipients: emails,
    });

    console.log(
      `Message ${messageId} sent successfully to ${
        emails.length
      } recipients at ${moment().tz(TIMEZONE).format()}`
    );

    if (activeJobs.has(messageId)) {
      activeJobs.get(messageId).stop();
      activeJobs.delete(messageId);
    }

    return true;
  } catch (error) {
    console.error(`Error sending message ${messageId}:`, error);
    try {
      const messageRef = doc(db, "messages", messageId);
      await updateDoc(messageRef, {
        error: error.message,
        lastAttempt: Timestamp.now(),
      });
    } catch (updateError) {
      console.error("Error updating message status:", updateError);
    }
    throw error;
  }
}

function scheduleMessage(messageId, eventId, content, date) {
  const parsedDate = parseDate(date);
  if (!parsedDate.isValid()) {
    throw new Error("Invalid date for scheduling");
  }

  const cronExpression = convertToCronExpression(date);
  console.log(
    `Scheduling message ${messageId} for ${parsedDate.format()} (${cronExpression})`
  );

  if (activeJobs.has(messageId)) {
    activeJobs.get(messageId).stop();
  }

  const job = cron.schedule(
    cronExpression,
    async () => {
      try {
        await sendMessage(messageId, eventId, content);
      } catch (error) {
        console.error(`Failed to send scheduled message ${messageId}:`, error);
      }
    },
    {
      scheduled: true,
      timezone: TIMEZONE,
    }
  );

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

      if (messageDate.isAfter(now)) {
        futureMessages.push(doc);
      } else {
        missedMessages.push(doc);
      }
    });

    if (missedMessages.length > 0) {
      console.log(`Processing ${missedMessages.length} missed messages...`);
      await handleMissedMessages(missedMessages);
    }

    console.log(`Scheduling ${futureMessages.length} future messages...`);
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
        messageDate.format()
      );
    });
  } catch (error) {
    console.error("Error loading unsent messages:", error);
  }
}

async function storeMessage(message, eventId, date) {
  try {
    const parsedDate = parseDate(date);
    if (!parsedDate.isValid()) {
      throw new Error("Invalid date for storage");
    }

    const messageData = {
      content: message,
      eventId: eventId,
      date: Timestamp.fromDate(parsedDate.toDate()),
      sent: false,
      createdAt: Timestamp.now(),
      originalDateString: date,
      normalizedDate: parsedDate.format(),
      timezone: TIMEZONE,
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

// API endpoint
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
    const messageId = await storeMessage(message, id, normalizedDate);

    // Check if the date is in the past
    if (parsedDate.isBefore(currentDate)) {
      console.log("Date is in the past, sending immediately...");
      try {
        await sendMessage(messageId, id, message);
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
    scheduleMessage(messageId, id, message, normalizedDate);

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

// Server setup
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Using timezone: ${TIMEZONE}`);
  loadUnsentMessages().catch(console.error);
});

// Error handling
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
