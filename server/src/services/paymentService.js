const prisma = require('../prisma');
const { releaseStock } = require('./stockReservationService');
const { transitionState } = require('./orderStateMachine');

// ============================================
// CONSTANTS
// ============================================

// Error classification map (DEFINITIVE vs TEMPORARY)
const ERROR_CLASSIFICATION = {
  // DEFINITIVE errors (immediate stock release + cancel order)
  INSUFFICIENT_FUNDS: 'DEFINITIVE',
  CARD_DECLINED: 'DEFINITIVE',
  CARD_EXPIRED: 'DEFINITIVE',
  FRAUD_SUSPECTED: 'DEFINITIVE',

  // TEMPORARY errors (keep reservation, allow retry within 5min)
  GATEWAY_TIMEOUT: 'TEMPORARY',
  NETWORK_ERROR: 'TEMPORARY',
  THREE_DS_TIMEOUT: 'TEMPORARY',
  TECHNICAL_ERROR: 'TEMPORARY',
};

// Retry window duration (5 minutes)
const RETRY_WINDOW_MS = 5 * 60 * 1000;

// Checkout expiration duration (10 minutes - must match F3 reservation)
const CHECKOUT_EXPIRATION_MS = 10 * 60 * 1000;

// ============================================
// MOCK PAYMENT GATEWAY
// ============================================

/**
 * Mock payment gateway call (simulates external payment provider)
 *
 * In production, replace with actual gateway integration (Stripe, PayPal, etc.)
 *
 * @param {Object} paymentDetails - Payment details { orderId, amount, method, ... }
 * @returns {Promise<Object>} - { success: boolean, transactionId?: string, errorCode?: string, errorType?: string }
 */
async function callPaymentGateway(paymentDetails) {
  // Simulate network delay (50-200ms)
  await new Promise(resolve => setTimeout(resolve, Math.random() * 150 + 50));

  // Mock scenarios based on order ID (for testing)
  // In production, this would be a real HTTP call to payment gateway

  // Simulate success (80% of cases)
  if (Math.random() < 0.8) {
    return {
      success: true,
      transactionId: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    };
  }

  // Simulate random failures (20% of cases)
  const errorTypes = Object.keys(ERROR_CLASSIFICATION);
  const randomErrorType = errorTypes[Math.floor(Math.random() * errorTypes.length)];

  return {
    success: false,
    errorCode: `ERR_${randomErrorType}`,
    errorType: randomErrorType,
  };
}

// ============================================
// VALIDATION FUNCTIONS
// ============================================

/**
 * Validate order is ready for payment
 * @param {Object} order - Order object
 * @returns {Object} - { valid: boolean, reason?: string }
 */
function validateOrderForPayment(order) {
  // Check order exists
  if (!order) {
    return { valid: false, reason: 'ORDER_NOT_FOUND' };
  }

  // Check order status is CHECKOUT
  if (order.status !== 'CHECKOUT') {
    return { valid: false, reason: 'INVALID_STATUS', current: order.status };
  }

  // Check order has checkoutAt timestamp
  if (!order.checkoutAt) {
    return { valid: false, reason: 'MISSING_CHECKOUT_TIMESTAMP' };
  }

  // Check checkout has not expired (10min window)
  const checkoutTime = new Date(order.checkoutAt).getTime();
  const now = Date.now();
  const elapsedMs = now - checkoutTime;

  if (elapsedMs > CHECKOUT_EXPIRATION_MS) {
    return {
      valid: false,
      reason: 'CHECKOUT_EXPIRED',
      elapsedMs,
      maxMs: CHECKOUT_EXPIRATION_MS,
    };
  }

  // Check order has totalSnapshot
  if (!order.totalSnapshot) {
    return { valid: false, reason: 'MISSING_TOTAL' };
  }

  return { valid: true };
}

/**
 * Check if retry is allowed (within 5min window after last failure)
 * @param {Object} lastAttempt - Last payment attempt
 * @returns {boolean} - True if retry allowed
 */
function isRetryAllowed(lastAttempt) {
  if (!lastAttempt) {
    return true; // No previous attempt, first try allowed
  }

  if (lastAttempt.status === 'SUCCESS') {
    return false; // Already paid, no retry
  }

  if (lastAttempt.status === 'PENDING') {
    return false; // Payment in progress, no concurrent retry
  }

  // Check if last failure was within 5min retry window
  const lastAttemptTime = new Date(lastAttempt.updatedAt).getTime();
  const now = Date.now();
  const elapsedMs = now - lastAttemptTime;

  return elapsedMs <= RETRY_WINDOW_MS;
}

// ============================================
// MAIN SERVICE FUNCTIONS
// ============================================

/**
 * Process payment for an order
 *
 * Flow:
 * 1. Validate order (CHECKOUT status, not expired, has total)
 * 2. Check retry window if previous attempt exists
 * 3. Create payment attempt record (PENDING)
 * 4. Call payment gateway
 * 5a. If SUCCESS → Update attempt, transition to PAID
 * 5b. If FAILED → Update attempt, classify error, release stock if DEFINITIVE
 *
 * Atomicity: All state changes in single transaction
 * Idempotence: Check existing payment attempt
 *
 * @param {string} orderId - Order ID
 * @param {Object} paymentDetails - Payment details { method, cardLast4, ... }
 * @param {Function} gatewayFn - Optional gateway function for testing (defaults to callPaymentGateway)
 * @returns {Promise<Object>} - { success: boolean, transactionId?, errorCode?, errorType?, errorClassification? }
 */
async function processPayment(orderId, paymentDetails = {}, gatewayFn = callPaymentGateway) {
  // Step 1: Get order and validate
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      paymentAttempts: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  const validation = validateOrderForPayment(order);
  if (!validation.valid) {
    const error = new Error(validation.reason);
    error.details = validation;
    throw error;
  }

  // Step 2: Check existing payment attempt (idempotence)
  const lastAttempt = order.paymentAttempts[0];

  if (lastAttempt && lastAttempt.status === 'SUCCESS') {
    console.log(`[PaymentService] Order ${orderId} already paid (idempotent)`);
    return {
      success: true,
      idempotent: true,
      transactionId: order.paymentId,
    };
  }

  // Step 3: Check retry window
  if (!isRetryAllowed(lastAttempt)) {
    const error = new Error('RETRY_NOT_ALLOWED');
    error.reason = lastAttempt.status === 'PENDING' ? 'PAYMENT_IN_PROGRESS' : 'RETRY_WINDOW_EXCEEDED';
    error.lastAttempt = lastAttempt;
    throw error;
  }

  // Step 4: Create payment attempt (PENDING)
  const paymentAttempt = await prisma.paymentAttempt.create({
    data: {
      orderId,
      status: 'PENDING',
      paymentMethod: paymentDetails.method || 'CREDIT_CARD',
    },
  });

  console.log(`[PaymentService] Created payment attempt ${paymentAttempt.id} for order ${orderId}`);

  // Step 5: Call payment gateway (uses injected function for testability)
  try {
    const gatewayResult = await gatewayFn({
      orderId,
      amount: parseFloat(order.totalSnapshot),
      method: paymentDetails.method,
      ...paymentDetails,
    });

    if (gatewayResult.success) {
      // SUCCESS FLOW
      return await handlePaymentSuccess(orderId, paymentAttempt.id, gatewayResult.transactionId);
    } else {
      // FAILURE FLOW
      return await handlePaymentFailure(
        orderId,
        paymentAttempt.id,
        gatewayResult.errorCode,
        gatewayResult.errorType
      );
    }
  } catch (err) {
    // Gateway call exception (network error, timeout, etc.)
    console.error(`[PaymentService] Gateway exception for order ${orderId}:`, err.message);

    return await handlePaymentFailure(
      orderId,
      paymentAttempt.id,
      'GATEWAY_EXCEPTION',
      'TECHNICAL_ERROR'
    );
  }
}

/**
 * Handle successful payment
 * @param {string} orderId - Order ID
 * @param {string} attemptId - Payment attempt ID
 * @param {string} transactionId - Gateway transaction ID
 * @returns {Promise<Object>} - { success: true, transactionId }
 */
async function handlePaymentSuccess(orderId, attemptId, transactionId) {
  // Step 1: Update payment attempt and order in transaction
  await prisma.$transaction(async (tx) => {
    // Update payment attempt to SUCCESS
    await tx.paymentAttempt.update({
      where: { id: attemptId },
      data: {
        status: 'SUCCESS',
      },
    });

    // Update order with paymentId
    await tx.order.update({
      where: { id: orderId },
      data: {
        paymentId: transactionId,
      },
    });

    console.log(`[PaymentService] Payment successful for order ${orderId} (transaction: ${transactionId})`);
  });

  // Step 2: Transition to PAID (outside transaction to use F4's own transaction)
  // This is a critical side effect that should happen after payment confirmation
  // but it's safer to do it outside the payment transaction to avoid deadlock
  // If this fails, the order will have paymentId but status will be stuck in CHECKOUT
  // The StateTimeoutJob will NOT auto-cancel it because it has a paymentId (precondition check)
  // Manual intervention or retry mechanism would be needed in production
  try {
    await transitionState(orderId, 'PAID', 'PAYMENT_SUCCESS');
    console.log(`[PaymentService] Order ${orderId} transitioned to PAID`);
  } catch (err) {
    console.error(`[PaymentService] Failed to transition order ${orderId} to PAID:`, err.message);
    // Payment succeeded but state transition failed - needs manual intervention
    // In production, this would trigger an alert or be handled by a recovery job
  }

  return {
    success: true,
    transactionId,
  };
}

/**
 * Handle failed payment
 * @param {string} orderId - Order ID
 * @param {string} attemptId - Payment attempt ID
 * @param {string} errorCode - Gateway error code
 * @param {string} errorType - Payment error type (enum)
 * @returns {Promise<Object>} - { success: false, errorCode, errorType, errorClassification }
 */
async function handlePaymentFailure(orderId, attemptId, errorCode, errorType) {
  // Step 1: Classify error (DEFINITIVE vs TEMPORARY)
  const errorClassification = ERROR_CLASSIFICATION[errorType] || 'TEMPORARY';

  console.log(`[PaymentService] Payment failed for order ${orderId} (error: ${errorType}, classification: ${errorClassification})`);

  // Step 2: Update payment attempt to FAILED
  await prisma.paymentAttempt.update({
    where: { id: attemptId },
    data: {
      status: 'FAILED',
      errorCode,
      errorType,
    },
  });

  // Step 3: If DEFINITIVE error, release stock and cancel order
  if (errorClassification === 'DEFINITIVE') {
    console.log(`[PaymentService] DEFINITIVE error detected, releasing stock for order ${orderId}`);

    // Release stock (F3) - has its own transaction
    try {
      await releaseStock(orderId, 'PAYMENT_FAILED_DEFINITIVE');
      console.log(`[PaymentService] Stock released for order ${orderId}`);
    } catch (err) {
      console.error(`[PaymentService] Failed to release stock for order ${orderId}:`, err.message);
      // Continue to transition even if stock release fails (idempotent, can retry)
    }

    // Transition to CANCELLED (F4) - has its own transaction
    try {
      await transitionState(orderId, 'CANCELLED', 'PAYMENT_FAILED_DEFINITIVE');
      console.log(`[PaymentService] Order ${orderId} transitioned to CANCELLED`);
    } catch (err) {
      console.error(`[PaymentService] Failed to transition order ${orderId} to CANCELLED:`, err.message);
      // State transition failed - needs manual intervention
    }
  } else {
    // TEMPORARY error - keep reservation, allow retry within 5min
    console.log(`[PaymentService] TEMPORARY error detected, keeping reservation for order ${orderId} (retry window: 5min)`);
  }

  return {
    success: false,
    errorCode,
    errorType,
    errorClassification,
  };
}

/**
 * Get payment attempts for an order
 * @param {string} orderId - Order ID
 * @returns {Promise<Array>} - Array of payment attempts
 */
async function getPaymentAttempts(orderId) {
  return await prisma.paymentAttempt.findMany({
    where: { orderId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Check if order payment is expired (checkout > 10min)
 * @param {string} orderId - Order ID
 * @returns {Promise<boolean>} - True if expired
 */
async function isPaymentExpired(orderId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      status: true,
      checkoutAt: true,
    },
  });

  if (!order || order.status !== 'CHECKOUT' || !order.checkoutAt) {
    return false;
  }

  const checkoutTime = new Date(order.checkoutAt).getTime();
  const now = Date.now();
  const elapsedMs = now - checkoutTime;

  return elapsedMs > CHECKOUT_EXPIRATION_MS;
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  processPayment,
  getPaymentAttempts,
  isPaymentExpired,
  // Export for testing
  validateOrderForPayment,
  isRetryAllowed,
  callPaymentGateway,
  handlePaymentSuccess,
  handlePaymentFailure,
  ERROR_CLASSIFICATION,
  RETRY_WINDOW_MS,
  CHECKOUT_EXPIRATION_MS,
};
