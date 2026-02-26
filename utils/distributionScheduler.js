/**
 * Distribution Scheduler - Revenue Share
 * 
 * Handles end-of-month distribution scheduling
 * Starting February 2026, distributions occur on the last day of every month
 */

/**
 * Check if today is the distribution day
 * @param {string} scheduleType - 'last' for last day, or number 1-31
 * @returns {boolean}
 */
export function isDistributionDay(scheduleType = 'last') {
  const now = new Date();
  
  if (scheduleType === 'last') {
    // Check if today is the last day of the month
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.getMonth() !== now.getMonth();
  } else {
    // Check if today is the specified day
    const scheduleDay = parseInt(scheduleType);
    return now.getDate() === scheduleDay;
  }
}

/**
 * Get current distribution period ID
 * Format: revenue_dist_YYYY_MM
 */
export function getCurrentDistributionId() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `revenue_dist_${year}_${month}`;
}

/**
 * Get the next distribution date
 * @param {string} scheduleType - 'last' for last day, or number 1-31
 * @returns {Date}
 */
export function getNextDistributionDate(scheduleType = 'last') {
  const now = new Date();
  const next = new Date(now);
  
  if (scheduleType === 'last') {
    // Last day of current month
    next.setMonth(next.getMonth() + 1);
    next.setDate(0); // Last day of previous month
  } else {
    const scheduleDay = parseInt(scheduleType);
    next.setDate(scheduleDay);
    if (next <= now) {
      next.setMonth(next.getMonth() + 1);
    }
  }
  
  return next;
}

/**
 * Get previous distribution ID
 * @param {string} currentId - Current distribution ID (e.g., revenue_dist_2026_02)
 * @returns {string} Previous distribution ID
 */
export function getPreviousDistributionId(currentId) {
  const match = currentId.match(/revenue_dist_(\d{4})_(\d{2})/);
  if (!match) {
    throw new Error('Invalid distribution ID format');
  }
  
  const year = parseInt(match[1]);
  const month = parseInt(match[2]);
  
  // Go back one month
  let prevYear = year;
  let prevMonth = month - 1;
  
  if (prevMonth === 0) {
    prevMonth = 12;
    prevYear = year - 1;
  }
  
  return `revenue_dist_${prevYear}_${String(prevMonth).padStart(2, '0')}`;
}

/**
 * Get distribution month display name
 * @param {string} distributionId - e.g., revenue_dist_2026_02
 * @returns {string} - e.g., "February 2026"
 */
export function getDistributionMonthName(distributionId) {
  const match = distributionId.match(/revenue_dist_(\d{4})_(\d{2})/);
  if (!match) {
    return distributionId;
  }
  
  const month = parseInt(match[2]);
  const year = match[1];
  
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  
  return `${monthNames[month - 1]} ${year}`;
}

/**
 * Cron expression for end-of-month (at 23:00 UTC)
 * L = last day of month (supported by most cron implementations)
 */
export const END_OF_MONTH_CRON = '0 23 L * *';

/**
 * Alternative cron for systems that don't support L
 * Use day 28-31 and check if it's the last day in the job
 */
export const END_OF_MONTH_CRON_ALT = '0 23 28-31 * *';

/**
 * Check if a date is within the claim period
 * @param {Date} distributionDate - Distribution date
 * @param {number} expiryDays - Number of days until expiry
 * @returns {Object} { isClaimable, expiresAt, daysRemaining }
 */
export function checkClaimPeriod(distributionDate, expiryDays = 30) {
  const now = new Date();
  const expiresAt = new Date(distributionDate);
  expiresAt.setDate(expiresAt.getDate() + expiryDays);
  
  const isClaimable = now >= distributionDate && now <= expiresAt;
  const daysRemaining = Math.max(0, Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)));
  
  return {
    isClaimable,
    expiresAt,
    daysRemaining,
    isExpired: now > expiresAt,
  };
}

export default {
  isDistributionDay,
  getCurrentDistributionId,
  getNextDistributionDate,
  getPreviousDistributionId,
  getDistributionMonthName,
  END_OF_MONTH_CRON,
  END_OF_MONTH_CRON_ALT,
  checkClaimPeriod,
};
