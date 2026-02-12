const prisma = require("../prisma");

// ============================================
// CONSTANTS - Allowed state transitions
// ============================================

// Map of allowed state transitions (hardcoded graph)
// Format: { fromState: [allowedToStates] }
const TRANSITIONS_MAP = {
  CART: ["CHECKOUT", "CANCELLED"],
  CHECKOUT: ["PAID", "CANCELLED"],
  PAID: ["PREPARING", "CANCELLED"],
  PREPARING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [], // Terminal state
  CANCELLED: [], // Terminal state
};

// Timeout configurations for states (in milliseconds)
const STATE_TIMEOUTS = {
  CHECKOUT: 15 * 60 * 1000, // 15 minutes
  PREPARING: 48 * 60 * 60 * 1000, // 48 hours
};

// ============================================
// VALIDATION FUNCTIONS
// ============================================

/**
 * Validate if transition is allowed according to TRANSITIONS_MAP
 */
function isTransitionAllowed(fromState, toState) {
  const allowedStates = TRANSITIONS_MAP[fromState];
  if (!allowedStates) {
    return false;
  }
  return allowedStates.includes(toState);
}

/**
 * Validate preconditions for specific target states
 * - PAID requires paymentId
 * - PREPARING requires active stock reservations
 * - SHIPPED requires tracking info (future)
 */
async function validatePreconditions(order, toState, tx) {
  switch (toState) {
    case "PAID":
      if (!order.paymentId) {
        throw new Error("PRECONDITION_FAILED: PAID state requires paymentId");
      }
      break;

    case "PREPARING":
      // Check if stock reservations exist and are active
      const reservations = await tx.stockReservation.findMany({
        where: {
          orderId: order.id,
          status: "ACTIVE",
        },
      });

      if (reservations.length === 0) {
        throw new Error(
          "PRECONDITION_FAILED: PREPARING state requires active stock reservations",
        );
      }
      break;

    case "SHIPPED":
      // Future: validate tracking_number exists
      break;

    default:
      // No preconditions for other states
      break;
  }
}

/**
 * Execute critical side effects synchronously within transaction
 * - CANCELLED: Release stock reservations
 * - PAID: Confirm stock reservations
 */
async function executeCriticalSideEffects(order, fromState, toState, tx) {
  if (toState === "CANCELLED") {
    // Release all active stock reservations
    const reservations = await tx.stockReservation.findMany({
      where: {
        orderId: order.id,
        status: "ACTIVE",
      },
    });

    for (const reservation of reservations) {
      // Increment stock_available, decrement stock_reserved
      await tx.product.update({
        where: { id: reservation.productId },
        data: {
          stockAvailable: { increment: reservation.quantity },
          stockReserved: { decrement: reservation.quantity },
        },
      });

      // Mark reservation as RELEASED
      await tx.stockReservation.update({
        where: { id: reservation.id },
        data: {
          status: "RELEASED",
          releasedAt: new Date(),
        },
      });
    }

    console.log(
      `[OrderStateMachine] Stock released for order ${order.id} (${reservations.length} reservations)`,
    );
  }

  if (toState === "PAID") {
    // Confirm stock reservations (mark as CONFIRMED)
    await tx.stockReservation.updateMany({
      where: {
        orderId: order.id,
        status: "ACTIVE",
      },
      data: {
        status: "CONFIRMED",
      },
    });

    console.log(
      `[OrderStateMachine] Stock reservations confirmed for order ${order.id}`,
    );
  }
}

/**
 * Execute non-critical side effects asynchronously after commit
 * - Emails, webhooks, notifications
 * - Failures are logged but don't rollback transaction
 */
async function executeNonCriticalSideEffects(order, fromState, toState) {
  try {
    // Future: Send email notifications
    // Future: Trigger webhooks
    // Future: Push notifications

    console.log(
      `[OrderStateMachine] Non-critical side effects executed for order ${order.id} (${fromState}→${toState})`,
    );
  } catch (err) {
    console.error(
      `[OrderStateMachine] Non-critical side effect failed for order ${order.id}:`,
      err.message,
    );
    // Don't throw - non-critical failures are logged only
  }
}

// ============================================
// MAIN TRANSITION FUNCTION
// ============================================

/**
 * Transition order from current state to target state
 *
 * Algorithm:
 * 1. Lock order with FOR UPDATE (pessimistic lock)
 * 2. Validate transition is allowed (TRANSITIONS_MAP)
 * 3. Validate preconditions for target state
 * 4. Execute critical side effects (in transaction)
 * 5. Update order status with optimistic lock (version)
 * 6. Create audit log entry
 * 7. Execute non-critical side effects (after commit)
 *
 * @param {string} orderId - Order ID
 * @param {string} toState - Target state (OrderStatus enum)
 * @param {string} reason - Transition reason (e.g., 'PAYMENT_SUCCESS', 'TIMEOUT')
 * @param {string} actor - Actor performing transition (user ID or 'SYSTEM')
 * @returns {Promise<Object>} - { success: true, order: updatedOrder }
 */
async function transitionOrderState(
  orderId,
  toState,
  reason,
  actor = "SYSTEM",
) {
  return await prisma
    .$transaction(
      async (tx) => {
        // Step 1: Lock order (pessimistic lock for read)
        // Note: Prisma doesn't support FOR UPDATE directly, but transaction isolation provides locking
        const order = await tx.order.findUnique({
          where: { id: orderId },
        });

        if (!order) {
          throw new Error("ORDER_NOT_FOUND");
        }

        const fromState = order.status;

        // Idempotence check: if already in target state, return success
        if (fromState === toState) {
          console.log(
            `[OrderStateMachine] Order ${orderId} already in state ${toState} (idempotent)`,
          );
          return { success: true, idempotent: true, order };
        }

        // Step 2: Validate transition is allowed
        if (!isTransitionAllowed(fromState, toState)) {
          throw new Error(
            `INVALID_TRANSITION: ${fromState} → ${toState} not allowed`,
          );
        }

        // Step 3: Validate preconditions
        await validatePreconditions(order, toState, tx);

        // Step 4: Execute critical side effects (in transaction)
        await executeCriticalSideEffects(order, fromState, toState, tx);

        // Step 5: Update order status with optimistic lock
        const result = await tx.order.updateMany({
          where: {
            id: orderId,
            status: fromState,
            version: order.version, // Optimistic lock
          },
          data: {
            status: toState,
            version: { increment: 1 },
            // Set checkoutAt timestamp when transitioning to CHECKOUT
            ...(toState === "CHECKOUT" ? { checkoutAt: new Date() } : {}),
          },
        });

        if (result.count === 0) {
          throw new Error(
            "CONCURRENT_MODIFICATION: Order was modified by another transaction",
          );
        }

        // Step 6: Create audit log entry
        await tx.orderStateAudit.create({
          data: {
            orderId,
            fromState,
            toState,
            reason,
            actor,
          },
        });

        // Fetch updated order
        const updatedOrder = await tx.order.findUnique({
          where: { id: orderId },
        });

        console.log(
          `[OrderStateMachine] Transition successful: Order ${orderId} (${fromState}→${toState}) by ${actor}`,
        );

        return { success: true, idempotent: false, order: updatedOrder };
      },
      {
        isolationLevel: "Serializable", // Highest isolation level for consistency
      },
    )
    .then(async (result) => {
      // Step 7: Execute non-critical side effects after commit
      await executeNonCriticalSideEffects(
        result.order,
        result.order.status,
        toState,
      );
      return result;
    });
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  transitionOrderState,
  isTransitionAllowed,
  TRANSITIONS_MAP,
  STATE_TIMEOUTS,
};
