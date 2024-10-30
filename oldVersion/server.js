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

// New helper function for generating verification code
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
// New endpoint for sending verification code
app.post("/api/verify-email", async (req, res) => {
  const { documentId } = req.body;

  if (!documentId) {
    return res.status(400).json({ error: "Document ID is required" });
  }

  try {
    // Get the pending participant document
    const pendingDoc = await getDoc(doc(db, "pendingParticipants", documentId));
    if (!pendingDoc.exists()) {
      return res.status(404).json({ error: "Document not found" });
    }

    const pendingData = pendingDoc.data();
    const email = pendingData["0"]; // Email is stored in field "0"
    const verificationCode = pendingData.verificationCode;

    // Send verification email
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || "hello@web-events-two.vercel.app",
      to: email,
      subject: "Event Registration Verification Code",
      text: `Your verification code is: ${verificationCode}. This code will expire in 10 minutes.`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Email Verification</h2>
          <p>Your verification code is:</p>
          <h1 style="font-size: 32px; letter-spacing: 5px; color: #4F46E5; background: #F3F4F6; padding: 20px; text-align: center; border-radius: 8px;">
            ${verificationCode}
          </h1>
          <p>This code will expire in 10 minutes.</p>
          <p>If you didn't request this code, please ignore this email.</p>
        </div>
      `,
    });

    res.json({ 
      success: true, 
      message: "Verification code sent",
      email: email // Send back email for UI feedback
    });
  } catch (error) {
    console.error("Error sending verification code:", error);
    res.status(500).json({ 
      error: "Failed to send verification code",
      details: error.message 
    });
  }
});

// New endpoint for checking email existence
app.post("/api/check-email", async (req, res) => {
  const { email, eventId } = req.body;

  if (!email || !eventId) {
    return res.status(400).json({ error: "Email and event ID are required" });
  }

  try {
    // Check participants collection
    const participantsRef = collection(doc(db, "events", eventId), "participants");
    const participantsQuery = query(participantsRef, where("0", "==", email));
    const existingParticipant = await getDocs(participantsQuery);

    if (!existingParticipant.empty) {
      return res.json({ 
        exists: true, 
        collection: "participants",
        message: "Email already registered for this event" 
      });
    }

    // Check pending participants
    const pendingRef = collection(db, "pendingParticipants");
    const pendingQuery = query(pendingRef, where("0", "==", email));
    const existingPending = await getDocs(pendingQuery);

    if (!existingPending.empty) {
      // Get the creation time of the pending document
      const pendingData = existingPending.docs[0].data();
      const createdAt = pendingData.createdAt.toDate();
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

      // If the document is older than 10 minutes, delete it
      if (createdAt < tenMinutesAgo) {
        await deleteDoc(existingPending.docs[0].ref);
        return res.json({ 
          exists: false,
          message: "Previous verification expired" 
        });
      }

      return res.json({ 
        exists: true, 
        collection: "pending",
        message: "Email verification already in progress" 
      });
    }

    res.json({ 
      exists: false,
      message: "Email available" 
    });
  } catch (error) {
    console.error("Error checking email:", error);
    res.status(500).json({ 
      error: "Failed to check email",
      details: error.message 
    });
  }
});

// New endpoint for verifying code and moving data
app.post("/api/confirm-verification", async (req, res) => {
  const { documentId, code, eventId } = req.body;

  if (!documentId || !code || !eventId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // Get the pending document
    const pendingDoc = await getDoc(doc(db, "pendingParticipants", documentId));
    if (!pendingDoc.exists()) {
      return res.status(404).json({ error: "Verification expired or not found" });
    }

    const pendingData = pendingDoc.data();
    
    // Check if code matches
    if (pendingData.verificationCode !== code) {
      return res.status(400).json({ error: "Invalid verification code" });
    }

    // Check if document is not expired (10 minutes)
    const createdAt = pendingData.createdAt.toDate();
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    if (createdAt < tenMinutesAgo) {
      await deleteDoc(doc(db, "pendingParticipants", documentId));
      return res.status(400).json({ error: "Verification code expired" });
    }

    // Check if email already exists in participants (double-check)
    const email = pendingData["0"];
    const participantsRef = collection(doc(db, "events", eventId), "participants");
    const participantsQuery = query(participantsRef, where("0", "==", email));
    const existingParticipant = await getDocs(participantsQuery);

    if (!existingParticipant.empty) {
      await deleteDoc(doc(db, "pendingParticipants", documentId));
      return res.status(400).json({ error: "Email already registered" });
    }

    // Move data to participants collection
    const { verificationCode, ...participantData } = pendingData;
    const newParticipantRef = doc(participantsRef);
    await setDoc(newParticipantRef, {
      ...participantData,
      joinedAt: Timestamp.now(),
    });

    // Delete pending document
    await deleteDoc(doc(db, "pendingParticipants", documentId));

    res.json({ 
      success: true,
      message: "Email verified successfully" 
    });
  } catch (error) {
    console.error("Error confirming verification:", error);
    res.status(500).json({ 
      error: "Failed to confirm verification",
      details: error.message 
    });
  }
});

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

    // Get all documents from the participants collection
    const joinedCollectionRef = collection(
      doc(db, "events", eventId),
      "participants"
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
async function updateEvent(eventId, messageId) {
  if (!eventId || !messageId) {
    throw new Error("Event ID and Message ID are required");
  }

  try {
    // Get a reference to the event document
    const eventRef = doc(db, "events", eventId);
    
    // First get the current document data
    const eventDoc = await getDoc(eventRef);
    
    if (!eventDoc.exists()) {
      throw new Error(`Event with ID ${eventId} not found`);
    }

    const eventData = eventDoc.data();
    
    // Initialize messages array if it doesn't exist
    const currentMessages = eventData.messages || [];
    
    // Add the new message ID if it's not already present
    if (!currentMessages.includes(messageId)) {
      const updatedMessages = [...currentMessages, messageId];
      
      // Update the document with the new messages array
      await updateDoc(eventRef, { 
        messages: updatedMessages,
        lastUpdated: Timestamp.now()
      });
      
      console.log(`Successfully updated event ${eventId} with message ${messageId}`);
      return {
        success: true,
        eventId,
        messageId,
        messageCount: updatedMessages.length
      };
    } else {
      console.log(`Message ${messageId} already exists in event ${eventId}`);
      return {
        success: true,
        eventId,
        messageId,
        messageCount: currentMessages.length,
        note: 'Message ID already existed in event'
      };
    }
  } catch (error) {
    console.error(`Error updating event ${eventId}:`, error);
    throw error; // Propagate error to be handled by the calling function
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
