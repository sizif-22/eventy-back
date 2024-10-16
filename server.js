require('dotenv').config();
const express = require('express');
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, collection, getDocs } = require('firebase/firestore');
const nodemailer = require('nodemailer');
const cron = require('node-cron');

const app = express();
app.use(express.json());

// Firebase configuration
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
  measurementId: process.env.FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// Create a transporter using SMTP
let transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST, // Should be 'smtp.gmail.com'
  port: process.env.SMTP_PORT, // Should be 587
  secure: false, // Use TLS
  auth: {
    user: process.env.SMTP_USER, // Your Gmail address
    pass: process.env.SMTP_PASS, // Your app password
  },
});



// Function to convert Date to cron expression
function dateToCron(date) {
  const minutes = date.getUTCMinutes();
  const hours = date.getUTCHours();
  const dayOfMonth = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  return `${minutes} ${hours} ${dayOfMonth} ${month} *`;
}

// Function to fetch emails and send messages
async function fetchEmailsAndSendMessages(id, message) {
  console.log(`Fetching document with id: ${id} at ${new Date().toISOString()}`);
  try {
    const docRef = doc(db, 'events', id);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const joinedCollectionRef = collection(docRef, 'joined');
      const joinedDocs = await getDocs(joinedCollectionRef);

      const emails = [];
      joinedDocs.forEach((joinedDoc) => {
        const data = joinedDoc.data();
        if (data['0']) {
          emails.push(data['0']);  // The email is directly in the '0' field
        }
      });

      console.log('Collected emails:', emails);

      // Send emails to all collected email addresses
      for (const email of emails) {
        await sendEmail(email, message);
      }
    } else {
      console.log(`No document found with id: ${id}`);
    }
  } catch (error) {
    console.error('Error fetching document or sending messages:', error);
  }
}

// Function to send email
async function sendEmail(email, message) {
  try {
    let info = await transporter.sendMail({
      from: 'hello@web-events-two.vercel.app',
      to: email,
      subject: "Event Notification",
      text: message,
      html: `<p>${message}</p>`,
    });

    console.log('Message sent: %s', info.messageId);
  } catch (error) {
    console.error('Error sending email to', email, ':', error.message);
    // Optionally, you can add retry logic or notify the user/admin
  }
}


app.post('/api/event', (req, res) => {
  const { date, id, message } = req.body;

  console.log('Received event data:', req.body);

  if (!date || !id || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const eventDate = new Date(date + 'Z');

  console.log('Parsed event date:', eventDate);

  if (isNaN(eventDate.getTime())) {
    return res.status(400).json({ error: 'Invalid date format' });
  }

  const cronExpression = dateToCron(eventDate);
  console.log(`Scheduled job for: ${eventDate.toISOString()}`);
  console.log('Cron expression:', cronExpression);

  if (!cron.validate(cronExpression)) {
    return res.status(400).json({ error: 'Invalid cron expression generated' });
  }

  const task = cron.schedule(cronExpression, () => {
    console.log(`Executing scheduled task at ${new Date().toISOString()}`);
    fetchEmailsAndSendMessages(id, message);
  }, {
    scheduled: true,
    timezone: "Africa/Cairo"
  });

  task.start();

  console.log(`Scheduled job set for: ${eventDate.toISOString()}`);
  res.json({ 
    success: true, 
    message: 'Event scheduled successfully', 
    scheduledFor: eventDate.toISOString(),
    cronExpression 
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});