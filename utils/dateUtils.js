const moment = require("moment-timezone");

const TIMEZONE = "Africa/Cairo";
moment.tz.setDefault(TIMEZONE);

function parseDate(dateString) {
  let parsed = moment.tz(dateString, TIMEZONE);

  if (!parsed.isValid()) {
    const formats = [
      "YYYY-MM-DD HH:mm:ss",
      "YYYY-MM-DDTHH:mm:ss",
      "YYYY-MM-DD HH:mm",
      "DD-MM-YYYY HH:mm:ss",
      "DD/MM/YYYY HH:mm:ss",
    ];
    parsed = moment.tz(dateString, formats, TIMEZONE);
  }

  return parsed;
}

function getCairoNow() {
  return moment().tz(TIMEZONE);
}

function convertToCronExpression(dateString) {
  const parsed = parseDate(dateString);
  if (!parsed.isValid()) {
    throw new Error("Invalid date for cron expression");
  }
  return `${parsed.minutes()} ${parsed.hours()} ${parsed.date()} ${
    parsed.month() + 1
  } *`;
}

module.exports = {
  TIMEZONE,
  parseDate,
  getCairoNow,
  convertToCronExpression,
};