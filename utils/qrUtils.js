const QRCode = require("qrcode");

const sendQR = async (email, text) => {
  try {
    // Generate PNG buffer
    const buffer = await QRCode.toBuffer(text, { type: "image/png" });

    // Convert buffer to base64
    const base64Image = buffer.toString("base64");

    // Send email with embedded image
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || "hello@web-events-two.vercel.app",
      to: email,
      subject: "Thank You for joining our Event",
      html: `
        <div style="color: red; font-family: sans-serif; font-size: larger;">
          Your QR:<br>
          <img src="data:image/png;base64,${base64Image}" alt="QR Code" />
        </div>
      `,
    });
  } catch (error) {
    console.error("Error in sendQR:", error);
    throw error;
  }
};

  
module.exports = sendQR;
