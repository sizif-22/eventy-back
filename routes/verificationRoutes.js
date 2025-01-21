const express = require("express");
const router = express.Router();
const {
  doc,
  getDoc,
  Timestamp,
  collection,
  deleteDoc,
  query,
  getDocs,
  serverTimestamp,
  where,
  setDoc,
} = require("firebase/firestore");
const { db } = require("../config/firebase");
const { transporter } = require("../config/email");
const { isWithinMinutes } = require("../utils/dateUtils");
const sendQR = require("../utils/qrUtils");


// Validation middleware
const validateEmailRequest = (req, res, next) => {
  const { email, eventId } = req.body;
  if (!email || !eventId) {
    return res.status(400).json({ error: "Email and event ID are required" });
  }
  next();
};

const validateVerificationRequest = (req, res, next) => {
  const { documentId, eventId } = req.body;
  if (!documentId || !eventId) {
    return res
      .status(400)
      .json({ error: "Document ID and event ID are required" });
  }
  next();
};

const validateConfirmationRequest = (req, res, next) => {
  const { documentId, code, eventId } = req.body;
  if (!documentId || !code || !eventId) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  next();
};

// Route handlers
router.post("/verify-email", validateVerificationRequest, async (req, res) => {
  try {
    const { documentId, eventId } = req.body;

    // Updated path to access pendingParticipants as a subcollection
    const pendingDoc = await getDoc(
      doc(db, "events", eventId, "pendingParticipants", documentId)
    );

    if (!pendingDoc.exists()) {
      return res.status(404).json({ error: "Document not found" });
    }

    const pendingData = pendingDoc.data();
    const email = pendingData["0"];
    const verificationCode = pendingData.verificationCode;

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
      email,
    });
  } catch (error) {
    console.error("Error sending verification code:", error);
    res.status(500).json({
      error: "Failed to send verification code",
      details: error.message,
    });
  }
});

router.post("/check-email", validateEmailRequest, async (req, res) => {
  try {
    const { email, eventId } = req.body;

    // Check participants collection
    const participantsRef = collection(
      doc(db, "events", eventId),
      "participants"
    );
    const participantsQuery = query(participantsRef, where("0", "==", email));
    const existingParticipant = await getDocs(participantsQuery);

    if (!existingParticipant.empty) {
      return res.json({
        exists: true,
        collection: "participants",
        message: "Email already registered for this event",
      });
    }

    // Updated: Check pending participants subcollection
    const pendingRef = collection(
      doc(db, "events", eventId),
      "pendingParticipants"
    );
    const pendingQuery = query(pendingRef, where("0", "==", email));
    const existingPending = await getDocs(pendingQuery);

    if (!existingPending.empty) {
      const pendingData = existingPending.docs[0].data();
      const createdAt = pendingData.createdAt.toDate();

      if (!isWithinMinutes(createdAt, 10)) {
        // Updated delete path
        await deleteDoc(existingPending.docs[0].ref);
        return res.json({
          exists: false,
          message: "Previous verification expired",
        });
      }

      return res.json({
        exists: true,
        collection: "pending",
        message: "Email verification already in progress",
      });
    }

    res.json({
      exists: false,
      message: "Email available",
    });
  } catch (error) {
    console.error("Error checking email:", error);
    res.status(500).json({
      error: "Failed to check email",
      details: error.message,
    });
  }
});

router.post(
  "/confirm-verification",
  validateConfirmationRequest,
  async (req, res) => {
    try {
      const { documentId, code, eventId } = req.body;

      // Get pending document
      const pendingDocRef = doc(
        db,
        "events",
        eventId,
        "pendingParticipants",
        documentId
      );

      const pendingDoc = await getDoc(pendingDocRef);

      if (!pendingDoc.exists()) {
        return res
          .status(404)
          .json({ error: "Verification expired or not found" });
      }

      const pendingData = pendingDoc.data();
      const email = pendingData["0"];

      // Validate verification code
      if (pendingData.verificationCode !== code) {
        return res.status(400).json({ error: "Invalid verification code" });
      }

      // Check if code is expired
      // const createdat = pendingData.createdAt.toDate();
      if (!isWithinMinutes(createdAt, 10)) {
        await deleteDoc(pendingDocRef);
        return res.status(400).json({ error: "Verification code expired" });
      }

      // Move to participants collection
      const { verificationCode, createdAt, ...participantData } = pendingData;
      const participantsRef = collection(
        doc(db, "events", eventId),
        "participants"
      );
      const newParticipantRef = doc(participantsRef);

      const docId = newParticipantRef.id;
      try {
        // Send QR with eventId and documentId concatenated
        await sendQR(email, eventId, docId);

        // Write participant data to Firestore
        const  joinedAt = serverTimestamp();
        await setDoc(newParticipantRef,joinedAt, participantData);
      } catch (error) {
        console.error(
          "Failed to send welcome message or save participant:",
          error
        );
      }

      // Delete pending document
      await deleteDoc(pendingDocRef);
      res.json({
        success: true,
        message: "Email verified successfully",
      });
    } catch (error) {
      console.error("Error confirming verification:", error);
      res.status(500).json({
        error: "Failed to confirm verification",
        details: error.message,
      });
    }
  }
);
router.delete("/delete-user", async (req, res) => {
  const { eventId, docId } = req.body;
  const docRef = doc(db, "events", eventId, "participants", docId);
  try {
    await deleteDoc(docRef);
  } catch (error) {
    console.error("participant did not get deleted yet");
    res.status(500).json({
      success: true,
      message: "participant did not get deleted yet",
    });
  }
  res.status(200).json({
    success: true,
    message: "participant deleted successfully",
  });
});

module.exports = router;
