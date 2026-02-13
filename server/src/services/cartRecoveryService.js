const crypto = require('crypto');
const prisma = require('../prisma');

// ============================================
// CONSTANTS
// ============================================

// Abandoned cart detection window (24h ±1h tolerance)
const MIN_ABANDONED_HOURS = 23;
const MAX_ABANDONED_HOURS = 25;

// Recovery token expiration (7 days)
const TOKEN_EXPIRATION_DAYS = 7;

// Batch size for scanning abandoned carts
const SCAN_BATCH_SIZE = 100;

// ============================================
// TOKEN GENERATION
// ============================================

/**
 * Generate secure random token for cart recovery
 * @returns {string} - 64-character hex token
 */
function generateRecoveryToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Calculate token expiration date (7 days from now)
 * @returns {Date} - Expiration date
 */
function calculateTokenExpiration() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + TOKEN_EXPIRATION_DAYS);
  return expiresAt;
}

// ============================================
// EMAIL SERVICE (MOCK)
// ============================================

/**
 * Send cart recovery email (mock implementation)
 * In production, replace with actual email service (SendGrid, Mailgun, etc.)
 *
 * @param {Object} cart - Cart order object
 * @param {Object} user - User object
 * @param {string} token - Recovery token
 * @returns {Promise<void>}
 */
async function sendRecoveryEmail(cart, user, token) {
  // Simulate email send delay (50-150ms)
  await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));

  // Mock: Log email details (in production, call email service API)
  console.log(`[CartRecoveryService] Email sent to ${user.email}`, {
    cartId: cart.id,
    userId: user.id,
    token,
    recoveryUrl: `${process.env.APP_URL || 'http://localhost:3000'}/cart/recover/${token}`,
  });

  // Simulate random email failure (5% of cases for testing)
  if (Math.random() < 0.05) {
    throw new Error('EMAIL_SERVICE_UNAVAILABLE');
  }
}

// ============================================
// MAIN SERVICE FUNCTIONS
// ============================================

/**
 * Scan abandoned carts and send recovery emails
 *
 * Flow:
 * 1. Find carts abandoned 23-25h ago
 * 2. Filter by marketing consent (GDPR compliance)
 * 3. Check not already sent (unicité relance)
 * 4. Generate token and update order (idempotent)
 * 5. Create recovery log entry
 * 6. Send email (non-blocking, errors logged)
 *
 * Atomicity: Each cart processed in separate transaction
 * Idempotence: WHERE recovery_email_sent = FALSE
 * Non-blocking: Email failures don't prevent flag update
 *
 * @param {number} batchSize - Maximum number of carts to process (default 100)
 * @returns {Promise<Object>} - { processed: number, sent: number, failed: number, errors: [] }
 */
async function scanAbandonedCarts(batchSize = SCAN_BATCH_SIZE) {
  const stats = {
    processed: 0,
    sent: 0,
    failed: 0,
    errors: [],
  };

  try {
    // Step 1: Calculate time window (23-25h ago)
    const now = new Date();
    const minAbandonedTime = new Date(now.getTime() - MAX_ABANDONED_HOURS * 60 * 60 * 1000);
    const maxAbandonedTime = new Date(now.getTime() - MIN_ABANDONED_HOURS * 60 * 60 * 1000);

    console.log(`[CartRecoveryService] Scanning abandoned carts between ${minAbandonedTime.toISOString()} and ${maxAbandonedTime.toISOString()}`);

    // Step 2: Find eligible abandoned carts
    const abandonedCarts = await prisma.order.findMany({
      where: {
        status: 'CART',
        createdAt: {
          gte: minAbandonedTime,
          lte: maxAbandonedTime,
        },
        recoveryEmailSent: false,
        user: {
          marketingConsent: true, // GDPR compliance - INV-F6-2
        },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            marketingConsent: true,
          },
        },
      },
      take: batchSize,
    });

    console.log(`[CartRecoveryService] Found ${abandonedCarts.length} eligible abandoned carts`);

    // Step 3: Process each cart
    for (const cart of abandonedCarts) {
      try {
        stats.processed++;

        // Generate recovery token
        const token = generateRecoveryToken();
        const expiresAt = calculateTokenExpiration();

        // Step 4: Update order with token (idempotent via WHERE condition)
        const updateResult = await prisma.order.updateMany({
          where: {
            id: cart.id,
            recoveryEmailSent: false, // Idempotence - INV-F6-1
          },
          data: {
            recoveryEmailSent: true,
            recoveryToken: token,
            recoveryTokenExpiresAt: expiresAt,
          },
        });

        // Check if update was successful (race condition protection)
        if (updateResult.count === 0) {
          console.log(`[CartRecoveryService] Cart ${cart.id} already processed (race condition)`);
          continue;
        }

        // Step 5: Create recovery log entry (tracking)
        await prisma.cartRecoveryLog.create({
          data: {
            orderId: cart.id,
            userId: cart.userId,
            token,
            expiresAt,
          },
        });

        console.log(`[CartRecoveryService] Created recovery token for cart ${cart.id} (expires: ${expiresAt.toISOString()})`);

        // Step 6: Send email (non-blocking - errors don't prevent flag update)
        try {
          await sendRecoveryEmail(cart, cart.user, token);
          stats.sent++;
          console.log(`[CartRecoveryService] Recovery email sent for cart ${cart.id}`);
        } catch (emailErr) {
          // Email failure is non-critical - flag already set to avoid retry spam
          stats.failed++;
          stats.errors.push({
            cartId: cart.id,
            error: emailErr.message,
          });
          console.error(`[CartRecoveryService] Failed to send email for cart ${cart.id}:`, emailErr.message);
          // Continue processing other carts
        }
      } catch (err) {
        stats.failed++;
        stats.errors.push({
          cartId: cart.id,
          error: err.message,
        });
        console.error(`[CartRecoveryService] Failed to process cart ${cart.id}:`, err.message);
        // Continue processing other carts
      }
    }

    console.log(`[CartRecoveryService] Scan completed: ${stats.processed} processed, ${stats.sent} sent, ${stats.failed} failed`);

    return stats;
  } catch (err) {
    console.error('[CartRecoveryService] Scan failed:', err.message);
    throw err;
  }
}

/**
 * Recover cart from token
 *
 * Flow:
 * 1. Validate token exists and not expired
 * 2. Verify cart still in CART status
 * 3. Update recovery log with click timestamp
 * 4. Return cart details for session restoration
 *
 * @param {string} token - Recovery token from email link
 * @returns {Promise<Object>} - { cart, user }
 */
async function recoverCart(token) {
  // Step 1: Find order by token
  const order = await prisma.order.findFirst({
    where: {
      recoveryToken: token,
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  });

  // Validate token exists
  if (!order) {
    const error = new Error('TOKEN_INVALID');
    error.details = { reason: 'Token not found' };
    throw error;
  }

  // Step 2: Validate token not expired - INV-F6-3
  const now = new Date();
  if (order.recoveryTokenExpiresAt && order.recoveryTokenExpiresAt < now) {
    const error = new Error('TOKEN_EXPIRED');
    error.details = {
      expiresAt: order.recoveryTokenExpiresAt,
      now,
    };
    throw error;
  }

  // Step 3: Validate cart still in CART status (not converted)
  if (order.status !== 'CART') {
    const error = new Error('CART_ALREADY_CONVERTED');
    error.details = {
      currentStatus: order.status,
    };
    throw error;
  }

  // Step 4: Update recovery log with click timestamp (idempotent)
  await prisma.cartRecoveryLog.updateMany({
    where: {
      token,
      clickedAt: null, // Idempotence - only update if not already clicked
    },
    data: {
      clickedAt: new Date(),
    },
  });

  console.log(`[CartRecoveryService] Cart ${order.id} recovered via token ${token}`);

  return {
    cart: order,
    user: order.user,
  };
}

/**
 * Track cart recovery conversion (cart → paid order)
 *
 * Called when a recovered cart is successfully converted to PAID order
 *
 * @param {string} orderId - Order ID
 * @returns {Promise<void>}
 */
async function trackConversion(orderId) {
  // Find recovery log for this order
  const recoveryLog = await prisma.cartRecoveryLog.findUnique({
    where: { orderId },
  });

  if (!recoveryLog) {
    // Not a recovered cart, nothing to track
    return;
  }

  // Update conversion timestamp (idempotent)
  await prisma.cartRecoveryLog.updateMany({
    where: {
      orderId,
      convertedAt: null, // Idempotence - only update if not already converted
    },
    data: {
      convertedAt: new Date(),
    },
  });

  console.log(`[CartRecoveryService] Conversion tracked for order ${orderId}`);
}

/**
 * Get recovery statistics
 *
 * @param {Date} startDate - Start date for stats (optional)
 * @param {Date} endDate - End date for stats (optional)
 * @returns {Promise<Object>} - { sent, clicked, converted, conversionRate }
 */
async function getRecoveryStats(startDate = null, endDate = null) {
  const where = {};

  if (startDate || endDate) {
    where.emailSentAt = {};
    if (startDate) where.emailSentAt.gte = startDate;
    if (endDate) where.emailSentAt.lte = endDate;
  }

  const logs = await prisma.cartRecoveryLog.findMany({
    where,
  });

  const stats = {
    sent: logs.length,
    clicked: logs.filter(log => log.clickedAt !== null).length,
    converted: logs.filter(log => log.convertedAt !== null).length,
  };

  stats.clickRate = stats.sent > 0 ? (stats.clicked / stats.sent * 100).toFixed(2) : 0;
  stats.conversionRate = stats.sent > 0 ? (stats.converted / stats.sent * 100).toFixed(2) : 0;

  return stats;
}

/**
 * Check if cart is eligible for recovery
 *
 * @param {string} cartId - Cart order ID
 * @returns {Promise<Object>} - { eligible: boolean, reason?: string }
 */
async function isEligibleForRecovery(cartId) {
  const cart = await prisma.order.findUnique({
    where: { id: cartId },
    include: {
      user: {
        select: {
          marketingConsent: true,
        },
      },
    },
  });

  if (!cart) {
    return { eligible: false, reason: 'CART_NOT_FOUND' };
  }

  if (cart.status !== 'CART') {
    return { eligible: false, reason: 'NOT_CART_STATUS', currentStatus: cart.status };
  }

  if (cart.recoveryEmailSent) {
    return { eligible: false, reason: 'ALREADY_SENT' };
  }

  if (!cart.user.marketingConsent) {
    return { eligible: false, reason: 'NO_MARKETING_CONSENT' };
  }

  const now = new Date();
  const minAbandonedTime = new Date(now.getTime() - MAX_ABANDONED_HOURS * 60 * 60 * 1000);
  const maxAbandonedTime = new Date(now.getTime() - MIN_ABANDONED_HOURS * 60 * 60 * 1000);

  if (cart.createdAt < minAbandonedTime) {
    return { eligible: false, reason: 'TOO_OLD', createdAt: cart.createdAt };
  }

  if (cart.createdAt > maxAbandonedTime) {
    return { eligible: false, reason: 'TOO_RECENT', createdAt: cart.createdAt };
  }

  return { eligible: true };
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  scanAbandonedCarts,
  recoverCart,
  trackConversion,
  getRecoveryStats,
  isEligibleForRecovery,
  // Export for testing
  generateRecoveryToken,
  calculateTokenExpiration,
  sendRecoveryEmail,
  MIN_ABANDONED_HOURS,
  MAX_ABANDONED_HOURS,
  TOKEN_EXPIRATION_DAYS,
  SCAN_BATCH_SIZE,
};
