const QRCode = require("qrcode");
const { transporter } = require("../config/email");

const sendQR = async (email, text) => {
  try {
    // Generate PNG buffer from the QR code
    const buffer = await QRCode.toBuffer(text, { type: "image/png" });

    // Convert buffer to base64
    const base64Image = buffer.toString("base64");

    // Create the email content
    const emailContent = `
      <div style="font-family: sans-serif; font-size: larger;">
        Your QR:<br>
        <img src="data:image/png;base64,${base64Image}" alt="QR Code" />
      </div>
    `;

    // Send the email with the QR code
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || "hello@web-events-two.vercel.app",
      to: email,
      subject: "Thank You for joining our Event",
      html: emailContent,
    });

    console.log(`QR email sent to ${email}`);
  } catch (error) {
    console.error("Error in sendQR:", error);
    throw error;
  }
};

module.exports = sendQR;
