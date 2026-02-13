const prisma = require('../prisma');
const { releaseStock } = require('../services/stockReservationService');

// ============================================
// RESERVATION EXPIRATION JOB
// ============================================

/**
 * Background job that checks for expired stock reservations and releases them
 *
 * Checks:
 * - ACTIVE reservations with expiresAt <= NOW
 * - Calls releaseStock() for each expired order
 *
 * Runs every 30 seconds via setInterval
 */

let jobInterval = null;

/**
 * Process expired stock reservations
 */
async function processExpiredReservations() {
  const now = new Date();

  try {
    // Find all ACTIVE reservations that have expired
    const expiredReservations = await prisma.stockReservation.findMany({
      where: {
        status: 'ACTIVE',
        expiresAt: {
          lte: now,
        },
      },
      select: {
        orderId: true,
        expiresAt: true,
      },
      // Group by orderId to avoid processing same order multiple times
      distinct: ['orderId'],
    });

    if (expiredReservations.length === 0) {
      return;
    }

    console.log(`[ReservationExpirationJob] Found ${expiredReservations.length} expired reservations`);

    // Release stock for each expired order
    for (const reservation of expiredReservations) {
      try {
        await releaseStock(reservation.orderId, 'EXPIRED');

        const minutesExpired = Math.floor((now.getTime() - reservation.expiresAt.getTime()) / (1000 * 60));

        console.log(`[ReservationExpirationJob] Released stock for order ${reservation.orderId} (expired ${minutesExpired}min ago)`);
      } catch (err) {
        console.error(`[ReservationExpirationJob] Failed to release stock for order ${reservation.orderId}:`, err.message);
        // Continue processing other reservations
      }
    }
  } catch (err) {
    console.error('[ReservationExpirationJob] Error processing expired reservations:', err);
  }
}

/**
 * Main job execution function
 */
async function runJob() {
  console.log('[ReservationExpirationJob] Running expiration check...');
  await processExpiredReservations();
  console.log('[ReservationExpirationJob] Expiration check completed');
}

/**
 * Start the background job
 * @param {number} intervalMs - Interval in milliseconds (default: 30000 = 30 seconds)
 */
function startJob(intervalMs = 30000) {
  if (jobInterval) {
    console.warn('[ReservationExpirationJob] Job already running');
    return;
  }

  console.log(`[ReservationExpirationJob] Starting job with interval ${intervalMs}ms`);

  // Run immediately on start
  runJob();

  // Schedule periodic execution
  jobInterval = setInterval(runJob, intervalMs);
}

/**
 * Stop the background job
 */
function stopJob() {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
    console.log('[ReservationExpirationJob] Job stopped');
  }
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  startJob,
  stopJob,
  runJob, // Export for testing
};
