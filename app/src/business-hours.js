// Optimized business hours calculator for SLA response time calculations

/**
 * Calculate business minutes between two timestamps for a site
 * @param {number} startUnix - Start timestamp (Unix seconds)
 * @param {number} endUnix - End timestamp (Unix seconds)
 * @param {Object} site - Site with timezone and business_hours
 * @param {Set<string>} holidays - Set of holiday dates in YYYY-MM-DD format
 * @returns {number} Business minutes (floored)
 */
export function calculateBusinessMinutes(startUnix, endUnix, site, holidays) {
  if (endUnix <= startUnix) return 0;

  const { timezone, business_hours } = site;

  let totalSeconds = 0;
  let currentUnix = startUnix;

  // Process day by day instead of second by second for efficiency
  while (currentUnix < endUnix) {
    const currentDate = new Date(currentUnix * 1000);
    const localDateStr = toLocalDateString(currentDate, timezone);
    const dayOfWeek = getDayOfWeek(currentDate, timezone);

    // Check if it's a holiday
    if (holidays.has(localDateStr)) {
      // Skip to next day
      currentUnix = getNextDayStartUnix(currentUnix, timezone);
      continue;
    }

    // Check if day has business hours
    const dayHours = business_hours[dayOfWeek];
    if (!dayHours || dayHours === null) {
      // Closed all day
      currentUnix = getNextDayStartUnix(currentUnix, timezone);
      continue;
    }

    // Calculate business seconds for this day
    const { open, close } = dayHours;
    const dayStartUnix = getDayStartUnix(currentUnix, timezone);
    const openUnix = dayStartUnix + timeToSeconds(open);
    const closeUnix = dayStartUnix + timeToSeconds(close);

    // Find overlap between [currentUnix, endUnix] and [openUnix, closeUnix]
    const overlapStart = Math.max(currentUnix, openUnix);
    const overlapEnd = Math.min(endUnix, closeUnix);

    if (overlapStart < overlapEnd) {
      totalSeconds += overlapEnd - overlapStart;
    }

    // Move to next day
    currentUnix = getNextDayStartUnix(currentUnix, timezone);
  }

  // Floor to minutes
  return Math.floor(totalSeconds / 60);
}

/**
 * Convert time string to seconds since midnight
 * @param {string} time - "HH:MM"
 * @returns {number} Seconds since midnight
 */
function timeToSeconds(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 3600 + minutes * 60;
}

/**
 * Get Unix timestamp for start of day (00:00) in site timezone
 * @param {number} unixTimestamp
 * @param {string} timezone
 * @returns {number} Unix seconds
 */
function getDayStartUnix(unixTimestamp, timezone) {
  const date = new Date(unixTimestamp * 1000);
  const localDateStr = toLocalDateString(date, timezone);

  // Get midnight in local timezone
  // This is approximate - proper implementation needs timezone library
  const [year, month, day] = localDateStr.split('-').map(Number);
  const midnightUTC = Date.UTC(year, month - 1, day, 0, 0, 0) / 1000;

  // Adjust for timezone offset (approximate)
  const offsetSeconds = getTimezoneOffsetSeconds(date, timezone);
  return midnightUTC + offsetSeconds;
}

/**
 * Get Unix timestamp for start of next day in site timezone
 * @param {number} unixTimestamp
 * @param {string} timezone
 * @returns {number} Unix seconds
 */
function getNextDayStartUnix(unixTimestamp, timezone) {
  const dayStart = getDayStartUnix(unixTimestamp, timezone);
  return dayStart + 86400; // Add 24 hours
}

/**
 * Get timezone offset in seconds
 * @param {Date} date
 * @param {string} timezone
 * @returns {number} Offset in seconds
 */
function getTimezoneOffsetSeconds(date, timezone) {
  // Get the time in UTC and in the target timezone
  const utcTime = date.getTime();

  // Format date in target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const tzYear = parseInt(parts.find(p => p.type === 'year').value);
  const tzMonth = parseInt(parts.find(p => p.type === 'month').value);
  const tzDay = parseInt(parts.find(p => p.type === 'day').value);
  const tzHour = parseInt(parts.find(p => p.type === 'hour').value);
  const tzMinute = parseInt(parts.find(p => p.type === 'minute').value);
  const tzSecond = parseInt(parts.find(p => p.type === 'second').value);

  const tzTime = Date.UTC(tzYear, tzMonth - 1, tzDay, tzHour, tzMinute, tzSecond);

  return Math.floor((tzTime - utcTime) / 1000);
}

/**
 * Convert timestamp to local date string in site timezone
 * @param {Date} date
 * @param {string} timezone
 * @returns {string} YYYY-MM-DD
 */
function toLocalDateString(date, timezone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date); // Returns YYYY-MM-DD
}

/**
 * Get day of week in site timezone
 * @param {Date} date
 * @param {string} timezone
 * @returns {string} 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'
 */
function getDayOfWeek(date, timezone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  });
  const dayName = formatter.format(date).toLowerCase();
  return dayName;
}

/**
 * Parse DD/MM/YYYY to YYYY-MM-DD
 * @param {string} ddmmyyyy
 * @returns {string} YYYY-MM-DD
 */
export function parseDDMMYYYY(ddmmyyyy) {
  const [day, month, year] = ddmmyyyy.split('/');
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * Parse DD/MM/YYYY HH:MM to Unix timestamp in site timezone
 * @param {string} ddmmyyyyHHMM - "07/10/2026 10:00"
 * @param {string} timezone
 * @returns {number} Unix seconds
 */
export function parseLocalDateTime(ddmmyyyyHHMM, timezone) {
  const [datePart, timePart] = ddmmyyyyHHMM.split(' ');
  const [day, month, year] = datePart.split('/').map(Number);
  const [hours, minutes] = timePart.split(':').map(Number);

  // Create a date at this local time in UTC
  const utcDate = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));

  // Adjust for timezone (simplified - proper implementation needs library)
  const offsetSeconds = getTimezoneOffsetSeconds(utcDate, timezone);

  return Math.floor(utcDate.getTime() / 1000) - offsetSeconds;
}

/**
 * Convert ISO timestamp to local date in site timezone
 * @param {string} isoTimestamp - "2026-10-06T02:15:07Z"
 * @param {string} timezone
 * @returns {string} YYYY-MM-DD in local time
 */
export function getLocalDate(isoTimestamp, timezone) {
  const date = new Date(isoTimestamp);
  return toLocalDateString(date, timezone);
}
