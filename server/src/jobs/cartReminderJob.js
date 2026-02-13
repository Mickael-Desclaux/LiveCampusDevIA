const { scanAbandonedCarts } = require('../services/cartRecoveryService');

// ============================================
// CONSTANTS
// ============================================

// Job interval (5 minutes)
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

// ============================================
// JOB STATE
// ============================================

let intervalId = null;
let isRunning = false;

// ============================================
// JOB FUNCTIONS
// ============================================

/**
 * Process abandoned carts batch
 * Scans and sends recovery emails for carts abandoned 23-25h ago
 *
 * @returns {Promise<void>}
 */
async function processAbandonedCarts() {
  if (isRunning) {
    console.log('[CartReminderJob] Previous run still in progress, skipping...');
    return;
  }

  isRunning = true;

  try {
    console.log('[CartReminderJob] Starting abandoned cart scan...');

    const startTime = Date.now();
    const result = await scanAbandonedCarts();
    const duration = Date.now() - startTime;

    console.log(`[CartReminderJob] Scan completed in ${duration}ms`, {
      processed: result.processed,
      sent: result.sent,
      failed: result.failed,
    });

    if (result.errors.length > 0) {
      console.error('[CartReminderJob] Errors encountered:', result.errors);
    }
  } catch (err) {
    console.error('[CartReminderJob] Failed to process abandoned carts:', err.message);
  } finally {
    isRunning = false;
  }
}

/**
 * Start cart reminder job
 *
 * @param {number} intervalMs - Polling interval in milliseconds (default 5min)
 * @returns {void}
 */
function startJob(intervalMs = DEFAULT_INTERVAL_MS) {
  if (intervalId) {
    console.warn('[CartReminderJob] Job already running, use stopJob() first');
    return;
  }

  console.log(`[CartReminderJob] Starting job with interval ${intervalMs}ms (${intervalMs / 1000 / 60} minutes)`);

  // Run immediately on start
  processAbandonedCarts().catch(err => {
    console.error('[CartReminderJob] Initial run failed:', err.message);
  });

  // Schedule periodic runs
  intervalId = setInterval(() => {
    processAbandonedCarts().catch(err => {
      console.error('[CartReminderJob] Scheduled run failed:', err.message);
    });
  }, intervalMs);

  console.log('[CartReminderJob] Job started successfully');
}

/**
 * Stop cart reminder job
 *
 * @returns {void}
 */
function stopJob() {
  if (!intervalId) {
    console.warn('[CartReminderJob] Job not running');
    return;
  }

  clearInterval(intervalId);
  intervalId = null;
  isRunning = false;

  console.log('[CartReminderJob] Job stopped');
}

/**
 * Get job status
 *
 * @returns {Object} - { running: boolean, isProcessing: boolean }
 */
function getStatus() {
  return {
    running: intervalId !== null,
    isProcessing: isRunning,
  };
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  startJob,
  stopJob,
  processAbandonedCarts,
  getStatus,
  DEFAULT_INTERVAL_MS,
};
