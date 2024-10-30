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

/**
 * Checks if a given date is within a specified number of minutes from now
 * @param {Date} date - The date to check
 * @param {number} minutes - The number of minutes to check against
 * @returns {boolean} - True if the date is within the specified minutes from now
 */
function isWithinMinutes(date, minutes) {
  const now = getCairoNow();
  const givenDate = moment(date).tz(TIMEZONE);
  
  // Calculate the difference in minutes
  const diffInMinutes = now.diff(givenDate, 'minutes');
  
  // Check if the absolute difference is less than the specified minutes
  return Math.abs(diffInMinutes) < minutes;
}

module.exports = {
  TIMEZONE,
  parseDate,
  getCairoNow,
  convertToCronExpression,
  isWithinMinutes,
};