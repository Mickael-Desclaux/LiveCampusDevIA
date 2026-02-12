const prisma = require('../prisma');
const { transitionOrderState, STATE_TIMEOUTS } = require('../services/orderStateMachine');

// ============================================
// STATE TIMEOUT JOB
// ============================================

/**
 * Background job that checks for expired states and auto-transitions to CANCELLED
 *
 * Checks:
 * - CHECKOUT state with checkoutAt > 15 minutes → transition to CANCELLED
 * - PREPARING state with updatedAt > 48 hours → alert ops (manual intervention required)
 *
 * Runs every 60 seconds via setInterval
 */

let jobInterval = null;

/**
 * Check and process expired CHECKOUT orders
 */
async function processExpiredCheckouts() {
  const checkoutTimeout = STATE_TIMEOUTS.CHECKOUT;
  const expirationThreshold = new Date(Date.now() - checkoutTimeout);

  try {
    // Find orders in CHECKOUT state that have exceeded timeout
    const expiredOrders = await prisma.order.findMany({
      where: {
        status: 'CHECKOUT',
        checkoutAt: {
          lte: expirationThreshold,
        },
      },
      select: {
        id: true,
        checkoutAt: true,
      },
    });

    if (expiredOrders.length === 0) {
      return;
    }

    console.log(`[StateTimeoutJob] Found ${expiredOrders.length} expired CHECKOUT orders`);

    // Transition each expired order to CANCELLED
    for (const order of expiredOrders) {
      try {
        await transitionOrderState(
          order.id,
          'CANCELLED',
          'CHECKOUT_TIMEOUT',
          'SYSTEM'
        );

        console.log(`[StateTimeoutJob] Order ${order.id} transitioned to CANCELLED (checkout timeout)`);
      } catch (err) {
        console.error(`[StateTimeoutJob] Failed to cancel order ${order.id}:`, err.message);
        // Continue processing other orders
      }
    }
  } catch (err) {
    console.error('[StateTimeoutJob] Error processing expired checkouts:', err);
  }
}

/**
 * Check and alert on expired PREPARING orders
 * Note: PREPARING orders are not auto-cancelled, but ops team is alerted
 */
async function alertExpiredPreparing() {
  const preparingTimeout = STATE_TIMEOUTS.PREPARING;
  const expirationThreshold = new Date(Date.now() - preparingTimeout);

  try {
    // Find orders in PREPARING state that have exceeded timeout
    const expiredOrders = await prisma.order.findMany({
      where: {
        status: 'PREPARING',
        updatedAt: {
          lte: expirationThreshold,
        },
      },
      select: {
        id: true,
        userId: true,
        updatedAt: true,
      },
    });

    if (expiredOrders.length === 0) {
      return;
    }

    console.warn(`[StateTimeoutJob] ALERT: ${expiredOrders.length} orders in PREPARING state exceed 48h timeout`);

    // Log each expired order for ops team
    for (const order of expiredOrders) {
      const hoursSincePreparing = Math.floor((Date.now() - order.updatedAt.getTime()) / (1000 * 60 * 60));

      console.warn(`[StateTimeoutJob] ALERT: Order ${order.id} in PREPARING for ${hoursSincePreparing}h (user: ${order.userId})`);

      // Future: Send alert to ops dashboard, Slack, PagerDuty, etc.
    }
  } catch (err) {
    console.error('[StateTimeoutJob] Error alerting expired preparing orders:', err);
  }
}

/**
 * Main job execution function
 */
async function runJob() {
  console.log('[StateTimeoutJob] Running state timeout check...');

  await processExpiredCheckouts();
  await alertExpiredPreparing();

  console.log('[StateTimeoutJob] State timeout check completed');
}

/**
 * Start the background job
 * @param {number} intervalMs - Interval in milliseconds (default: 60000 = 1 minute)
 */
function startJob(intervalMs = 60000) {
  if (jobInterval) {
    console.warn('[StateTimeoutJob] Job already running');
    return;
  }

  console.log(`[StateTimeoutJob] Starting job with interval ${intervalMs}ms`);

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
    console.log('[StateTimeoutJob] Job stopped');
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
