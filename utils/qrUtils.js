const QRCode = require("qrcode");
const { transporter } = require("../config/email");

const sendQR = async (email, eventId, docId) => {
  const text = `${eventId}&&${docId}`;
  try {
    // Generate QR code as a buffer
    const qrBuffer = await QRCode.toBuffer(text, {
      width: 300,
      margin: 4,
      errorCorrectionLevel: "H",
      color: {
        dark: "#000000",
        light: "#FFFFFF",
      },
    });

    // Create email template with CID-referenced image
    const html = `
      <div style="
        font-family: Arial, sans-serif;
        max-width: 600px;
        margin: 0 auto;
        padding: 20px;
        background-color: #f9f9f9;
      ">
        <div style="
          background-color: white;
          padding: 30px;
          border-radius: 10px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          text-align: center;
        ">
          <h1 style="
            color: #333;
            margin-bottom: 20px;
            font-size: 24px;
          ">${eventId}</h1>
          
          <p style="
            color: #666;
            margin-bottom: 25px;
            font-size: 16px;
          ">Please keep this QR code safe. You'll need it for event check-in.</p>
          
          <div style="
            background-color: white;
            padding: 20px;
            display: inline-block;
            border-radius: 10px;
            border: 1px solid #eee;
          ">
            <img src="cid:qr-code" alt="Event QR Code" style="width: 300px; height: 300px; display: block;" />
          </div>
          
          <p style="
            color: #888;
            margin-top: 25px;
            font-size: 14px;
          ">This QR code is unique to you and cannot be transferred.</p>
        </div>
      </div>
    `;

    // Send the email with the QR code using CID
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || "hello@web-events-two.vercel.app",
      to: email,
      subject: "Your Event QR Code",
      text: `Your Event QR Code\nPlease keep this QR code safe. You'll need it for event check-in.`,
      html: html,
      attachments: [
        {
          filename: "qr-code.png",
          content: qrBuffer,
          contentType: "image/png",
          cid: "qr-code",
          contentDisposition: "inline", // Force inline display
          encoding: "base64", // Explicitly set encoding
        },
      ],
      encoding: "quoted-printable", // Set email encoding
    });

    console.log(`QR code email sent successfully to ${email}`);
    return true;
  } catch (error) {
    console.error("Error in sendQR:", error);
    throw error;
  }
};

module.exports = sendQR;
