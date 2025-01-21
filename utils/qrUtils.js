const QRCode = require("qrcode");
const { transporter } = require("../config/email");
const sendQR = async (email, text) => {
  const svg = await QRCode.toString(text, { type: "svg" });
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || "hello@web-events-two.vercel.app",
    to: email,
    subject: "Thank Your for joining our Event",
    text: `Thank Your for joining our Event, This is your QR code for the Event`,
    html: `<div style="color: red; font-family: sans-serif; font-size: larger;">Your QR:<br>
    <div style="width:400px;height:400px;">${svg}</div>
    </div>`,
  });
};
module.exports = sendQR;
