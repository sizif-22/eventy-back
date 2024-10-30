const { doc, getDoc, updateDoc, Timestamp } = require("firebase/firestore");
const { db } = require("../config/firebase");

async function updateEvent(eventId, messageId) {
  if (!eventId || !messageId) {
    throw new Error("Event ID and Message ID are required");
  }

  try {
    const eventRef = doc(db, "events", eventId);
    const eventDoc = await getDoc(eventRef);
    
    if (!eventDoc.exists()) {
      throw new Error(`Event with ID ${eventId} not found`);
    }

    const eventData = eventDoc.data();
    const currentMessages = eventData.messages || [];
    
    if (!currentMessages.includes(messageId)) {
      const updatedMessages = [...currentMessages, messageId];
      
      await updateDoc(eventRef, { 
        messages: updatedMessages,
        lastUpdated: Timestamp.now()
      });
      
      return {
        success: true,
        eventId,
        messageId,
        messageCount: updatedMessages.length
      };
    }
    
    return {
      success: true,
      eventId,
      messageId,
      messageCount: currentMessages.length,
      note: 'Message ID already existed in event'
    };
  } catch (error) {
    console.error(`Error updating event ${eventId}:`, error);
    throw error;
  }
}

module.exports = { updateEvent };