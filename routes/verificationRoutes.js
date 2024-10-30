const express = require("express");
const router = express.Router();

router.post("/verify-email", async (req, res) => {
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
      email: email, // Send back email for UI feedback
    });
  } catch (error) {
    console.error("Error sending verification code:", error);
    res.status(500).json({
      error: "Failed to send verification code",
      details: error.message,
    });
  }
});

router.post("/check-email", async (req, res) => {
  const { email, eventId } = req.body;

  if (!email || !eventId) {
    return res.status(400).json({ error: "Email and event ID are required" });
  }

  try {
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

router.post("/confirm-verification", async (req, res) => {
  const { documentId, code, eventId } = req.body;

  if (!documentId || !code || !eventId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // Get the pending document
    const pendingDoc = await getDoc(doc(db, "pendingParticipants", documentId));
    if (!pendingDoc.exists()) {
      return res
        .status(404)
        .json({ error: "Verification expired or not found" });
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
    const participantsRef = collection(
      doc(db, "events", eventId),
      "participants"
    );
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
      message: "Email verified successfully",
    });
  } catch (error) {
    console.error("Error confirming verification:", error);
    res.status(500).json({
      error: "Failed to confirm verification",
      details: error.message,
    });
  }
});

module.exports = router;
