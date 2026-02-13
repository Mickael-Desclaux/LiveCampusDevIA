const prisma = require('../prisma');

// ============================================
// CONSTANTS
// ============================================

// Default reservation duration (in milliseconds)
const DEFAULT_RESERVATION_DURATION = 10 * 60 * 1000; // 10 minutes

// Reservation durations by payment method (future enhancement)
const RESERVATION_DURATIONS = {
  CREDIT_CARD: 15 * 60 * 1000, // 15 minutes
  BANK_TRANSFER: 60 * 60 * 1000, // 1 hour
  WALLET: 5 * 60 * 1000, // 5 minutes
};

// ============================================
// VALIDATION FUNCTIONS
// ============================================

/**
 * Validate stock availability for requested items
 * @param {Array} items - Array of { productId, quantity }
 * @param {Object} tx - Prisma transaction client
 * @returns {Promise<Object>} - { valid: boolean, insufficientStock: [] }
 */
async function validateStockAvailability(items, tx) {
  const insufficientStock = [];

  for (const item of items) {
    const product = await tx.product.findUnique({
      where: { id: item.productId },
      select: {
        id: true,
        stockAvailable: true,
        stockTotal: true,
        stockReserved: true,
      },
    });

    if (!product) {
      insufficientStock.push({
        productId: item.productId,
        reason: 'PRODUCT_NOT_FOUND',
        requested: item.quantity,
        available: 0,
      });
      continue;
    }

    if (product.stockAvailable < item.quantity) {
      insufficientStock.push({
        productId: item.productId,
        reason: 'INSUFFICIENT_STOCK',
        requested: item.quantity,
        available: product.stockAvailable,
      });
    }
  }

  return {
    valid: insufficientStock.length === 0,
    insufficientStock,
  };
}

// ============================================
// MAIN SERVICE FUNCTIONS
// ============================================

/**
 * Reserve stock for an order
 *
 * Idempotence: Only one active reservation per order (UNIQUE constraint on orderId)
 * Atomicity: All stock updates and reservation creation in single transaction
 * Stock invariant: stockAvailable + stockReserved = stockTotal
 *
 * @param {string} orderId - Order ID
 * @param {Array} items - Array of { productId, quantity }
 * @param {number} durationMs - Reservation duration in milliseconds (default: 10min)
 * @returns {Promise<Object>} - { success: true, reservations: [], expiresAt }
 */
async function reserveStock(orderId, items, durationMs = DEFAULT_RESERVATION_DURATION) {
  // Validation: items array must not be empty
  if (!items || items.length === 0) {
    throw new Error('INVALID_ITEMS: Items array cannot be empty');
  }

  // Validation: all quantities must be positive
  for (const item of items) {
    if (item.quantity <= 0) {
      throw new Error(`INVALID_QUANTITY: Quantity must be positive for product ${item.productId}`);
    }
  }

  return await prisma.$transaction(async (tx) => {
    // Step 1: Check idempotence - if reservation already exists for this order, return existing
    const existingReservation = await tx.stockReservation.findFirst({
      where: {
        orderId,
        status: 'ACTIVE',
      },
    });

    if (existingReservation) {
      // Idempotent: return success without creating duplicate
      const allReservations = await tx.stockReservation.findMany({
        where: {
          orderId,
          status: 'ACTIVE',
        },
      });

      console.log(`[StockReservation] Order ${orderId} already has active reservation (idempotent)`);

      return {
        success: true,
        idempotent: true,
        reservations: allReservations,
        expiresAt: existingReservation.expiresAt,
      };
    }

    // Step 2: Validate stock availability for all items
    const validation = await validateStockAvailability(items, tx);

    if (!validation.valid) {
      const error = new Error('INSUFFICIENT_STOCK');
      error.insufficientStock = validation.insufficientStock;
      throw error;
    }

    // Step 3: Reserve stock atomically for each item
    const reservations = [];
    const expiresAt = new Date(Date.now() + durationMs);

    for (const item of items) {
      // 3a. Update product stock (decrement available, increment reserved)
      await tx.product.update({
        where: { id: item.productId },
        data: {
          stockAvailable: { decrement: item.quantity },
          stockReserved: { increment: item.quantity },
        },
      });

      // 3b. Create reservation record
      const reservation = await tx.stockReservation.create({
        data: {
          orderId,
          productId: item.productId,
          quantity: item.quantity,
          expiresAt,
          status: 'ACTIVE',
        },
      });

      reservations.push(reservation);
    }

    console.log(`[StockReservation] Reserved stock for order ${orderId} (${items.length} items, expires ${expiresAt.toISOString()})`);

    return {
      success: true,
      idempotent: false,
      reservations,
      expiresAt,
    };
  }, {
    isolationLevel: 'Serializable', // Highest isolation to prevent race conditions
  });
}

/**
 * Release stock reservation for an order
 *
 * Idempotence: Only releases ACTIVE reservations (WHERE status = ACTIVE)
 * Atomicity: All stock updates and status changes in single transaction
 *
 * @param {string} orderId - Order ID
 * @param {string} reason - Release reason (e.g., 'EXPIRED', 'CANCELLED', 'PAID')
 * @returns {Promise<Object>} - { success: true, releasedCount }
 */
async function releaseStock(orderId, reason = 'MANUAL') {
  return await prisma.$transaction(async (tx) => {
    // Step 1: Find all ACTIVE reservations for this order
    const reservations = await tx.stockReservation.findMany({
      where: {
        orderId,
        status: 'ACTIVE',
      },
    });

    // Idempotence check: if no active reservations, return success
    if (reservations.length === 0) {
      console.log(`[StockReservation] No active reservations to release for order ${orderId} (idempotent)`);
      return {
        success: true,
        idempotent: true,
        releasedCount: 0,
      };
    }

    // Step 2: Release stock atomically for each reservation
    for (const reservation of reservations) {
      // 2a. Update product stock (increment available, decrement reserved)
      await tx.product.update({
        where: { id: reservation.productId },
        data: {
          stockAvailable: { increment: reservation.quantity },
          stockReserved: { decrement: reservation.quantity },
        },
      });

      // 2b. Update reservation status to RELEASED
      await tx.stockReservation.update({
        where: { id: reservation.id },
        data: {
          status: 'RELEASED',
          releasedAt: new Date(),
        },
      });
    }

    console.log(`[StockReservation] Released stock for order ${orderId} (${reservations.length} reservations, reason: ${reason})`);

    return {
      success: true,
      idempotent: false,
      releasedCount: reservations.length,
    };
  }, {
    isolationLevel: 'Serializable',
  });
}

/**
 * Get active reservations for an order
 *
 * @param {string} orderId - Order ID
 * @returns {Promise<Array>} - Array of active reservations
 */
async function getActiveReservations(orderId) {
  return await prisma.stockReservation.findMany({
    where: {
      orderId,
      status: 'ACTIVE',
    },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          stockAvailable: true,
          stockReserved: true,
          stockTotal: true,
        },
      },
    },
  });
}

/**
 * Check if stock reservation is expired
 *
 * @param {string} orderId - Order ID
 * @returns {Promise<boolean>} - True if reservation is expired
 */
async function isReservationExpired(orderId) {
  const reservation = await prisma.stockReservation.findFirst({
    where: {
      orderId,
      status: 'ACTIVE',
    },
    orderBy: {
      expiresAt: 'asc', // Get earliest expiration
    },
  });

  if (!reservation) {
    return false; // No active reservation
  }

  return new Date() > reservation.expiresAt;
}

/**
 * Extend reservation expiration time
 *
 * @param {string} orderId - Order ID
 * @param {number} additionalMs - Additional time in milliseconds
 * @returns {Promise<Object>} - { success: true, newExpiresAt }
 */
async function extendReservation(orderId, additionalMs) {
  return await prisma.$transaction(async (tx) => {
    const reservations = await tx.stockReservation.findMany({
      where: {
        orderId,
        status: 'ACTIVE',
      },
    });

    if (reservations.length === 0) {
      throw new Error('NO_ACTIVE_RESERVATION');
    }

    const oldExpiresAt = reservations[0].expiresAt;
    const newExpiresAt = new Date(oldExpiresAt.getTime() + additionalMs);

    // Update all reservations for this order
    await tx.stockReservation.updateMany({
      where: {
        orderId,
        status: 'ACTIVE',
      },
      data: {
        expiresAt: newExpiresAt,
      },
    });

    console.log(`[StockReservation] Extended reservation for order ${orderId} from ${oldExpiresAt.toISOString()} to ${newExpiresAt.toISOString()}`);

    return {
      success: true,
      oldExpiresAt,
      newExpiresAt,
    };
  });
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  reserveStock,
  releaseStock,
  getActiveReservations,
  isReservationExpired,
  extendReservation,
  DEFAULT_RESERVATION_DURATION,
  RESERVATION_DURATIONS,
};
