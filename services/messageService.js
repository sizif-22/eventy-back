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
  // Implementation remains the same
}

async function handleMissedMessages(messages) {
  // Implementation remains the same
}

async function loadUnsentMessages() {
  // Implementation remains the same
}

async function storeMessage(message, eventId, date) {
  // Implementation remains the same
}

module.exports = {
  sendMessage,
  scheduleMessage,
  handleMissedMessages,
  loadUnsentMessages,
  storeMessage,
};