const { collection, doc, getDoc, getDocs, updateDoc, addDoc, query, where, Timestamp } = require("firebase/firestore");
const cron = require("node-cron");
const { db } = require("../config/firebase");
const { transporter } = require("../config/email");
const { parseDate, TIMEZONE } = require("../utils/dateUtils");

const activeJobs = new Map();

async function sendMessage(messageId, eventId, content) {
  try {
    const eventDoc = await getDoc(doc(db, "events", eventId));
    if (!eventDoc.exists()) {
      throw new Error(`Event ${eventId} not found`);
    }

    const joinedCollectionRef = collection(doc(db, "events", eventId), "participants");
    const joinedSnapshot = await getDocs(joinedCollectionRef);

    const emails = [];
    joinedSnapshot.forEach((joinedDoc) => {
      const participantData = joinedDoc.data();
      if (participantData["0"]) {
        emails.push(participantData["0"]);
      }
    });

    if (emails.length === 0) {
      throw new Error(`No participants found for event ${eventId}`);
    }

    for (const email of emails) {
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || "hello@web-events-two.vercel.app",
        to: email,
        subject: "Event Notification",
        text: content,
        html: `<p>${content}</p>`,
      });
    }

    const messageRef = doc(db, "messages", messageId);
    await updateDoc(messageRef, {
      sent: true,
      sentAt: Timestamp.now(),
      recipientCount: emails.length,
      recipients: emails,
    });

    if (activeJobs.has(messageId)) {
      activeJobs.get(messageId).stop();
      activeJobs.delete(messageId);
    }

    return true;
  } catch (error) {
    console.error(`Error sending message ${messageId}:`, error);
    const messageRef = doc(db, "messages", messageId);
    await updateDoc(messageRef, {
      error: error.message,
      lastAttempt: Timestamp.now(),
    });
    throw error;
  }
}

// Rest of messageService.js functions...
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


module.exports = {
  sendMessage,
  scheduleMessage,
  handleMissedMessages,
  loadUnsentMessages,
  storeMessage,
};