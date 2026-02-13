const prisma = require("../prisma");
const {
  validateAndApplyPromotions,
  incrementPromotionUsage,
} = require("./promotionService");
const { reserveStock } = require("./stockReservationService");
const { transitionState } = require("./orderStateMachine");

// ============================================
// CONSTANTS
// ============================================

const DEFAULT_RESERVATION_DURATION = 10 * 60 * 1000; // 10 minutes

// ============================================
// VALIDATION FUNCTIONS
// ============================================

/**
 * Validate cart before checkout
 * @param {Object} cart - Cart order object
 * @returns {Object} - { valid: boolean, errors: [] }
 */
function validateCart(cart) {
  const errors = [];

  // Check cart exists
  if (!cart) {
    errors.push({ field: "cart", reason: "CART_NOT_FOUND" });
    return { valid: false, errors };
  }

  // Check cart status is CART
  if (cart.status !== "CART") {
    errors.push({
      field: "status",
      reason: "INVALID_STATUS",
      current: cart.status,
    });
    return { valid: false, errors };
  }

  // Check cart has items
  if (!cart.itemsSnapshot || cart.itemsSnapshot.length === 0) {
    errors.push({ field: "items", reason: "EMPTY_CART" });
    return { valid: false, errors };
  }

  // Validate items structure
  for (const item of cart.itemsSnapshot) {
    if (!item.productId || !item.quantity || item.quantity <= 0) {
      errors.push({
        field: "items",
        reason: "INVALID_ITEM",
        productId: item.productId,
        quantity: item.quantity,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Create immutable price snapshot for cart items
 * @param {Array} items - Cart items [{ productId, quantity }]
 * @param {Object} tx - Prisma transaction client
 * @returns {Promise<Object>} - { subtotal, itemsSnapshot: [] }
 */
async function createPriceSnapshot(items, tx) {
  const itemsSnapshot = [];
  let subtotal = 0;

  for (const item of items) {
    const product = await tx.product.findUnique({
      where: { id: item.productId },
      select: {
        id: true,
        name: true,
        price: true,
        stockAvailable: true,
      },
    });

    if (!product) {
      throw new Error(`PRODUCT_NOT_FOUND: ${item.productId}`);
    }

    // Create immutable snapshot
    const priceSnapshot = parseFloat(product.price);
    const itemSubtotal = priceSnapshot * item.quantity;

    itemsSnapshot.push({
      productId: product.id,
      name: product.name,
      priceSnapshot,
      quantity: item.quantity,
      subtotal: itemSubtotal,
    });

    subtotal += itemSubtotal;
  }

  return { subtotal, itemsSnapshot };
}

/**
 * Calculate final total with promotions
 * @param {number} subtotal - Subtotal before promotions
 * @param {Object} promoResult - Result from validateAndApplyPromotions
 * @returns {number} - Final total
 */
function calculateTotal(subtotal, promoResult) {
  return promoResult.finalAmount;
}

// ============================================
// MAIN SERVICE FUNCTIONS
// ============================================

/**
 * Create order from cart (CART → CHECKOUT)
 *
 * Orchestrates:
 * - Price snapshot (immutable)
 * - Promotion application (F2)
 * - Stock reservation (F3)
 * - State transition (F4)
 *
 * Atomicity: All operations in single transaction
 * Idempotence: Check if already in CHECKOUT
 *
 * @param {string} userId - User ID
 * @param {Array} promoCodes - Optional promo codes to apply
 * @returns {Promise<Object>} - { success: true, order: {...}, reservations: [...] }
 */
async function createOrderFromCart(userId, promoCodes = []) {
  return await prisma.$transaction(
    async (tx) => {
      // Step 1: Get active cart for user
      const cart = await tx.order.findFirst({
        where: {
          userId,
          status: "CART",
        },
      });

      // Idempotence: Check if cart already converted to CHECKOUT
      if (!cart) {
        const existingCheckout = await tx.order.findFirst({
          where: {
            userId,
            status: "CHECKOUT",
          },
          orderBy: {
            checkoutAt: "desc",
          },
        });

        if (existingCheckout) {
          console.log(
            `[OrderService] User ${userId} already has a CHECKOUT order (idempotent)`,
          );
          return {
            success: true,
            idempotent: true,
            order: existingCheckout,
          };
        }

        throw new Error("CART_NOT_FOUND");
      }

      // Step 2: Validate cart
      const validation = validateCart(cart);
      if (!validation.valid) {
        const error = new Error("INVALID_CART");
        error.errors = validation.errors;
        throw error;
      }

      // Step 3: Check if already in CHECKOUT (race condition protection)
      if (cart.status !== "CART") {
        throw new Error(`INVALID_STATUS: Cart is already ${cart.status}`);
      }

      // Step 4: Create immutable price snapshot
      const { subtotal, itemsSnapshot } = await createPriceSnapshot(
        cart.itemsSnapshot,
        tx,
      );

      console.log(
        `[OrderService] Created price snapshot for cart ${cart.id} (subtotal: ${subtotal})`,
      );

      // Step 5: Apply promotions (F2)
      const promoResult = await validateAndApplyPromotions(
        userId,
        subtotal,
        promoCodes,
      );

      console.log(
        `[OrderService] Applied promotions (discount: ${promoResult.totalDiscount}, final: ${promoResult.finalAmount})`,
      );

      // Step 6: Reserve stock (F3) - OUTSIDE transaction to avoid deadlock
      // Stock reservation has its own transaction with Serializable isolation
      // We'll do this in a separate step after cart update

      // Step 7: Update order with snapshots (optimistic lock via version)
      const currentVersion = cart.version;

      const updateResult = await tx.order.updateMany({
        where: {
          id: cart.id,
          status: "CART",
          version: currentVersion, // Optimistic lock
        },
        data: {
          itemsSnapshot,
          totalSnapshot: promoResult.finalAmount,
          promoSnapshot: promoResult.appliedPromotions,
          version: { increment: 1 },
          checkoutAt: new Date(),
        },
      });

      if (updateResult.count === 0) {
        throw new Error(
          "CONCURRENT_MODIFICATION: Cart was modified by another request",
        );
      }

      // Step 8: Get updated cart
      const updatedCart = await tx.order.findUnique({
        where: { id: cart.id },
      });

      console.log(
        `[OrderService] Updated cart ${cart.id} with snapshots (version ${currentVersion} → ${updatedCart.version})`,
      );

      // Step 9: Increment promotion usage (F2)
      if (promoResult.appliedPromotions.length > 0) {
        const promotionIds = promoResult.appliedPromotions.map((p) => p.id);
        await incrementPromotionUsage(userId, promotionIds);
      }

      return {
        success: true,
        idempotent: false,
        order: updatedCart,
        promoResult,
      };
    },
    {
      isolationLevel: "Serializable", // Prevent race conditions
    },
  );
}

/**
 * Complete checkout process (reserve stock + transition state)
 *
 * Separate from createOrderFromCart to avoid transaction deadlock
 * Stock reservation uses its own transaction
 *
 * @param {string} orderId - Order ID (after createOrderFromCart)
 * @param {number} reservationDurationMs - Reservation duration (default 10min)
 * @returns {Promise<Object>} - { success: true, reservations: [...] }
 */
async function completeCheckout(
  orderId,
  reservationDurationMs = DEFAULT_RESERVATION_DURATION,
) {
  // Step 1: Get order
  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw new Error("ORDER_NOT_FOUND");
  }

  if (!order.itemsSnapshot || order.itemsSnapshot.length === 0) {
    throw new Error("ORDER_MISSING_ITEMS");
  }

  // Step 2: Reserve stock (F3)
  const items = order.itemsSnapshot.map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
  }));

  const reservationResult = await reserveStock(
    orderId,
    items,
    reservationDurationMs,
  );

  console.log(
    `[OrderService] Reserved stock for order ${orderId} (${items.length} items, expires ${reservationResult.expiresAt?.toISOString()})`,
  );

  // Step 3: Transition state CART → CHECKOUT (F4)
  await transitionState(orderId, "CHECKOUT", "USER_CHECKOUT");

  console.log(`[OrderService] Transitioned order ${orderId} to CHECKOUT`);

  return {
    success: true,
    order,
    reservations: reservationResult.reservations,
    expiresAt: reservationResult.expiresAt,
  };
}

/**
 * Add item to cart (or create cart if none exists)
 *
 * @param {string} userId - User ID
 * @param {string} productId - Product ID
 * @param {number} quantity - Quantity to add
 * @returns {Promise<Object>} - { success: true, cart: {...} }
 */
async function addItemToCart(userId, productId, quantity) {
  if (quantity <= 0) {
    throw new Error("INVALID_QUANTITY: Quantity must be positive");
  }

  return await prisma.$transaction(async (tx) => {
    // Step 1: Find or create cart
    let cart = await tx.order.findFirst({
      where: {
        userId,
        status: "CART",
      },
    });

    if (!cart) {
      // Create new cart
      cart = await tx.order.create({
        data: {
          userId,
          status: "CART",
          itemsSnapshot: [],
        },
      });

      console.log(`[OrderService] Created new cart for user ${userId}`);
    }

    // Step 2: Get product details
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        price: true,
        stockAvailable: true,
      },
    });

    if (!product) {
      throw new Error("PRODUCT_NOT_FOUND");
    }

    // Step 3: Soft check stock (non-blocking)
    if (product.stockAvailable < quantity) {
      throw new Error(
        `INSUFFICIENT_STOCK: Only ${product.stockAvailable} available`,
      );
    }

    // Step 4: Update cart items
    const currentItems = cart.itemsSnapshot || [];
    const existingItemIndex = currentItems.findIndex(
      (item) => item.productId === productId,
    );

    let updatedItems;
    if (existingItemIndex >= 0) {
      // Update existing item
      updatedItems = [...currentItems];
      updatedItems[existingItemIndex] = {
        productId,
        quantity: currentItems[existingItemIndex].quantity + quantity,
      };
    } else {
      // Add new item
      updatedItems = [...currentItems, { productId, quantity }];
    }

    // Step 5: Update cart
    const updatedCart = await tx.order.update({
      where: { id: cart.id },
      data: {
        itemsSnapshot: updatedItems,
        version: { increment: 1 },
      },
    });

    console.log(
      `[OrderService] Added ${quantity}x ${product.name} to cart ${cart.id}`,
    );

    return {
      success: true,
      cart: updatedCart,
    };
  });
}

/**
 * Get active cart for user
 *
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Cart order object or null
 */
async function getActiveCart(userId) {
  return await prisma.order.findFirst({
    where: {
      userId,
      status: "CART",
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
}

/**
 * Get checkout order for user
 *
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Checkout order object or null
 */
async function getCheckoutOrder(userId) {
  return await prisma.order.findFirst({
    where: {
      userId,
      status: "CHECKOUT",
    },
    orderBy: {
      checkoutAt: "desc",
    },
    include: {
      stockReservations: {
        where: {
          status: "ACTIVE",
        },
      },
    },
  });
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  createOrderFromCart,
  completeCheckout,
  addItemToCart,
  getActiveCart,
  getCheckoutOrder,
  DEFAULT_RESERVATION_DURATION,
  // Export for testing
  validateCart,
  createPriceSnapshot,
  calculateTotal,
};
