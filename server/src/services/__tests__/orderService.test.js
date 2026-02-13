const {
  createOrderFromCart,
  completeCheckout,
  addItemToCart,
  getActiveCart,
  getCheckoutOrder,
  validateCart,
  createPriceSnapshot,
  calculateTotal,
} = require('../orderService');
const { validateAndApplyPromotions, incrementPromotionUsage } = require('../promotionService');
const { reserveStock } = require('../stockReservationService');
const { transitionState } = require('../orderStateMachine');

// Mock dependencies
jest.mock('../../prisma', () => ({
  order: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  product: {
    findUnique: jest.fn(),
  },
  $transaction: jest.fn(callback => callback({
    order: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    product: {
      findUnique: jest.fn(),
    },
  })),
}));

jest.mock('../promotionService', () => ({
  validateAndApplyPromotions: jest.fn(),
  incrementPromotionUsage: jest.fn(),
}));

jest.mock('../stockReservationService', () => ({
  reserveStock: jest.fn(),
}));

jest.mock('../orderStateMachine', () => ({
  transitionState: jest.fn(),
}));

const prisma = require('../../prisma');

describe('OrderService - F1 Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================
  // TEST 1: Create Order From Cart (Nominal Case)
  // Criterion: Checkout conversion ≥98%, Atomicity
  // ============================================

  describe('Create Order From Cart', () => {
    test('should create order from cart successfully', async () => {
      const userId = 'user-1';
      const mockCart = {
        id: 'cart-1',
        userId,
        status: 'CART',
        version: 0,
        itemsSnapshot: [
          { productId: 'prod-1', quantity: 2 },
          { productId: 'prod-2', quantity: 1 },
        ],
      };

      const mockProduct1 = {
        id: 'prod-1',
        name: 'Product 1',
        price: 10.00,
        stockAvailable: 10,
      };

      const mockProduct2 = {
        id: 'prod-2',
        name: 'Product 2',
        price: 20.00,
        stockAvailable: 5,
      };

      const mockPromoResult = {
        finalAmount: 35.00,
        totalDiscount: 5.00,
        appliedPromotions: [
          { id: 'promo-1', code: 'SAVE5', type: 'FIXED_AMOUNT', tag: 'AUTO', amount: 5.00 },
        ],
      };

      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          order: {
            findFirst: jest.fn()
              .mockResolvedValueOnce(mockCart) // Get cart
              .mockResolvedValueOnce(null), // Check existing checkout
            findUnique: jest.fn().mockResolvedValue({
              ...mockCart,
              version: 1,
              itemsSnapshot: [
                { productId: 'prod-1', name: 'Product 1', priceSnapshot: 10.00, quantity: 2, subtotal: 20.00 },
                { productId: 'prod-2', name: 'Product 2', priceSnapshot: 20.00, quantity: 1, subtotal: 20.00 },
              ],
              totalSnapshot: 35.00,
              promoSnapshot: mockPromoResult.appliedPromotions,
              checkoutAt: new Date(),
            }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          product: {
            findUnique: jest.fn()
              .mockResolvedValueOnce(mockProduct1)
              .mockResolvedValueOnce(mockProduct2),
          },
        };

        return await callback(tx);
      });

      validateAndApplyPromotions.mockResolvedValue(mockPromoResult);
      incrementPromotionUsage.mockResolvedValue({ success: true });

      const result = await createOrderFromCart(userId, ['SAVE5']);

      expect(result.success).toBe(true);
      expect(result.idempotent).toBe(false);
      expect(result.order.version).toBe(1);
      expect(result.order.itemsSnapshot).toHaveLength(2);
      expect(result.order.totalSnapshot).toBe(35.00);
      expect(validateAndApplyPromotions).toHaveBeenCalledWith(userId, 40.00, ['SAVE5']);
      expect(incrementPromotionUsage).toHaveBeenCalledWith(userId, ['promo-1']);
    });

    test('should create immutable price snapshot', async () => {
      const items = [
        { productId: 'prod-1', quantity: 2 },
        { productId: 'prod-2', quantity: 1 },
      ];

      const mockTx = {
        product: {
          findUnique: jest.fn()
            .mockResolvedValueOnce({ id: 'prod-1', name: 'Product 1', price: 10.00, stockAvailable: 10 })
            .mockResolvedValueOnce({ id: 'prod-2', name: 'Product 2', price: 20.00, stockAvailable: 5 }),
        },
      };

      const result = await createPriceSnapshot(items, mockTx);

      expect(result.subtotal).toBe(40.00);
      expect(result.itemsSnapshot).toHaveLength(2);
      expect(result.itemsSnapshot[0]).toEqual({
        productId: 'prod-1',
        name: 'Product 1',
        priceSnapshot: 10.00,
        quantity: 2,
        subtotal: 20.00,
      });
      expect(result.itemsSnapshot[1]).toEqual({
        productId: 'prod-2',
        name: 'Product 2',
        priceSnapshot: 20.00,
        quantity: 1,
        subtotal: 20.00,
      });
    });

    test('should handle promotions correctly in total calculation', () => {
      const subtotal = 100.00;
      const promoResult = {
        finalAmount: 85.00,
        totalDiscount: 15.00,
      };

      const total = calculateTotal(subtotal, promoResult);

      expect(total).toBe(85.00);
    });
  });

  // ============================================
  // TEST 2: Validation
  // Criterion: Invalid cart detection ≥99%
  // ============================================

  describe('Cart Validation', () => {
    test('should validate cart successfully', () => {
      const validCart = {
        id: 'cart-1',
        userId: 'user-1',
        status: 'CART',
        itemsSnapshot: [
          { productId: 'prod-1', quantity: 2 },
        ],
      };

      const result = validateCart(validCart);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should reject null cart', () => {
      const result = validateCart(null);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({ field: 'cart', reason: 'CART_NOT_FOUND' });
    });

    test('should reject cart with invalid status', () => {
      const cart = {
        id: 'cart-1',
        status: 'CHECKOUT',
        itemsSnapshot: [{ productId: 'prod-1', quantity: 2 }],
      };

      const result = validateCart(cart);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'status',
        reason: 'INVALID_STATUS',
        current: 'CHECKOUT',
      });
    });

    test('should reject empty cart', () => {
      const cart = {
        id: 'cart-1',
        status: 'CART',
        itemsSnapshot: [],
      };

      const result = validateCart(cart);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({ field: 'items', reason: 'EMPTY_CART' });
    });

    test('should reject cart with invalid items', () => {
      const cart = {
        id: 'cart-1',
        status: 'CART',
        itemsSnapshot: [
          { productId: 'prod-1', quantity: 0 }, // Invalid quantity
          { productId: null, quantity: 1 }, // Invalid productId
        ],
      };

      const result = validateCart(cart);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
    });
  });

  // ============================================
  // TEST 3: Idempotence
  // Criterion: Idempotence 100%
  // ============================================

  describe('Idempotence', () => {
    test('should return existing checkout if cart already converted', async () => {
      const userId = 'user-1';
      const mockCheckoutOrder = {
        id: 'order-1',
        userId,
        status: 'CHECKOUT',
        checkoutAt: new Date(),
      };

      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          order: {
            findFirst: jest.fn()
              .mockResolvedValueOnce(null) // No cart
              .mockResolvedValueOnce(mockCheckoutOrder), // Existing checkout
          },
        };

        return await callback(tx);
      });

      const result = await createOrderFromCart(userId);

      expect(result.success).toBe(true);
      expect(result.idempotent).toBe(true);
      expect(result.order).toEqual(mockCheckoutOrder);
      expect(validateAndApplyPromotions).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // TEST 4: Error Handling
  // Criterion: Rollback 100%, Invalid detection ≥99%
  // ============================================

  describe('Error Handling', () => {
    test('should throw error if cart not found', async () => {
      const userId = 'user-1';

      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          order: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
        };

        return await callback(tx);
      });

      await expect(createOrderFromCart(userId)).rejects.toThrow('CART_NOT_FOUND');
    });

    test('should throw error if cart has invalid items', async () => {
      const userId = 'user-1';
      const mockCart = {
        id: 'cart-1',
        userId,
        status: 'CART',
        version: 0,
        itemsSnapshot: [], // Empty cart
      };

      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          order: {
            findFirst: jest.fn().mockResolvedValue(mockCart),
          },
        };

        return await callback(tx);
      });

      await expect(createOrderFromCart(userId)).rejects.toThrow('INVALID_CART');
    });

    test('should throw error if product not found during snapshot', async () => {
      const userId = 'user-1';
      const mockCart = {
        id: 'cart-1',
        userId,
        status: 'CART',
        version: 0,
        itemsSnapshot: [{ productId: 'prod-invalid', quantity: 1 }],
      };

      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          order: {
            findFirst: jest.fn().mockResolvedValue(mockCart),
          },
          product: {
            findUnique: jest.fn().mockResolvedValue(null), // Product not found
          },
        };

        return await callback(tx);
      });

      await expect(createOrderFromCart(userId)).rejects.toThrow('PRODUCT_NOT_FOUND');
    });
  });

  // ============================================
  // TEST 5: Optimistic Lock
  // Criterion: Concurrent modification detection
  // ============================================

  describe('Optimistic Lock', () => {
    test('should detect concurrent modification', async () => {
      const userId = 'user-1';
      const mockCart = {
        id: 'cart-1',
        userId,
        status: 'CART',
        version: 0,
        itemsSnapshot: [{ productId: 'prod-1', quantity: 1 }],
      };

      const mockProduct = {
        id: 'prod-1',
        name: 'Product 1',
        price: 10.00,
        stockAvailable: 10,
      };

      const mockPromoResult = {
        finalAmount: 10.00,
        totalDiscount: 0,
        appliedPromotions: [],
      };

      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          order: {
            findFirst: jest.fn().mockResolvedValue(mockCart),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }), // Concurrent modification
          },
          product: {
            findUnique: jest.fn().mockResolvedValue(mockProduct),
          },
        };

        return await callback(tx);
      });

      validateAndApplyPromotions.mockResolvedValue(mockPromoResult);

      await expect(createOrderFromCart(userId)).rejects.toThrow('CONCURRENT_MODIFICATION');
    });
  });

  // ============================================
  // TEST 6: Complete Checkout
  // Criterion: Stock reservation + state transition
  // ============================================

  describe('Complete Checkout', () => {
    test('should complete checkout with stock reservation and state transition', async () => {
      const orderId = 'order-1';
      const mockOrder = {
        id: orderId,
        userId: 'user-1',
        status: 'CART',
        itemsSnapshot: [
          { productId: 'prod-1', name: 'Product 1', priceSnapshot: 10.00, quantity: 2, subtotal: 20.00 },
        ],
        totalSnapshot: 20.00,
      };

      const mockReservation = {
        success: true,
        reservations: [
          { orderId, productId: 'prod-1', quantity: 2, status: 'ACTIVE' },
        ],
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      };

      prisma.order.findUnique.mockResolvedValue(mockOrder);
      reserveStock.mockResolvedValue(mockReservation);
      transitionState.mockResolvedValue({ success: true });

      const result = await completeCheckout(orderId);

      expect(result.success).toBe(true);
      expect(result.order).toEqual(mockOrder);
      expect(result.reservations).toEqual(mockReservation.reservations);
      expect(result.expiresAt).toEqual(mockReservation.expiresAt);
      expect(reserveStock).toHaveBeenCalledWith(
        orderId,
        [{ productId: 'prod-1', quantity: 2 }],
        10 * 60 * 1000
      );
      expect(transitionState).toHaveBeenCalledWith(orderId, 'CHECKOUT', 'USER_CHECKOUT');
    });

    test('should throw error if order not found', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(completeCheckout('order-invalid')).rejects.toThrow('ORDER_NOT_FOUND');
    });

    test('should throw error if order has no items', async () => {
      const mockOrder = {
        id: 'order-1',
        itemsSnapshot: [],
      };

      prisma.order.findUnique.mockResolvedValue(mockOrder);

      await expect(completeCheckout('order-1')).rejects.toThrow('ORDER_MISSING_ITEMS');
    });
  });

  // ============================================
  // TEST 7: Add Item to Cart
  // Criterion: Cart management
  // ============================================

  describe('Add Item to Cart', () => {
    test('should create new cart and add item', async () => {
      const userId = 'user-1';
      const productId = 'prod-1';
      const quantity = 2;

      const mockProduct = {
        id: productId,
        name: 'Product 1',
        price: 10.00,
        stockAvailable: 10,
      };

      const mockNewCart = {
        id: 'cart-1',
        userId,
        status: 'CART',
        itemsSnapshot: [],
        version: 0,
      };

      const mockUpdatedCart = {
        ...mockNewCart,
        itemsSnapshot: [{ productId, quantity: 2 }],
        version: 1,
      };

      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          order: {
            findFirst: jest.fn().mockResolvedValue(null), // No existing cart
            create: jest.fn().mockResolvedValue(mockNewCart),
            update: jest.fn().mockResolvedValue(mockUpdatedCart),
          },
          product: {
            findUnique: jest.fn().mockResolvedValue(mockProduct),
          },
        };

        return await callback(tx);
      });

      const result = await addItemToCart(userId, productId, quantity);

      expect(result.success).toBe(true);
      expect(result.cart.itemsSnapshot).toEqual([{ productId, quantity: 2 }]);
    });

    test('should add item to existing cart', async () => {
      const userId = 'user-1';
      const productId = 'prod-1';
      const quantity = 1;

      const mockProduct = {
        id: productId,
        name: 'Product 1',
        price: 10.00,
        stockAvailable: 10,
      };

      const mockExistingCart = {
        id: 'cart-1',
        userId,
        status: 'CART',
        itemsSnapshot: [{ productId, quantity: 2 }],
        version: 0,
      };

      const mockUpdatedCart = {
        ...mockExistingCart,
        itemsSnapshot: [{ productId, quantity: 3 }],
        version: 1,
      };

      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          order: {
            findFirst: jest.fn().mockResolvedValue(mockExistingCart),
            update: jest.fn().mockResolvedValue(mockUpdatedCart),
          },
          product: {
            findUnique: jest.fn().mockResolvedValue(mockProduct),
          },
        };

        return await callback(tx);
      });

      const result = await addItemToCart(userId, productId, quantity);

      expect(result.success).toBe(true);
      expect(result.cart.itemsSnapshot[0].quantity).toBe(3);
    });

    test('should throw error if quantity is invalid', async () => {
      await expect(addItemToCart('user-1', 'prod-1', 0)).rejects.toThrow('INVALID_QUANTITY');
      await expect(addItemToCart('user-1', 'prod-1', -1)).rejects.toThrow('INVALID_QUANTITY');
    });

    test('should throw error if product not found', async () => {
      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          order: {
            findFirst: jest.fn().mockResolvedValue({ id: 'cart-1', itemsSnapshot: [] }),
          },
          product: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        };

        return await callback(tx);
      });

      await expect(addItemToCart('user-1', 'prod-invalid', 1)).rejects.toThrow('PRODUCT_NOT_FOUND');
    });

    test('should throw error if insufficient stock', async () => {
      const mockProduct = {
        id: 'prod-1',
        stockAvailable: 1,
      };

      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          order: {
            findFirst: jest.fn().mockResolvedValue({ id: 'cart-1', itemsSnapshot: [] }),
          },
          product: {
            findUnique: jest.fn().mockResolvedValue(mockProduct),
          },
        };

        return await callback(tx);
      });

      await expect(addItemToCart('user-1', 'prod-1', 5)).rejects.toThrow('INSUFFICIENT_STOCK');
    });
  });

  // ============================================
  // TEST 8: Get Cart Functions
  // Criterion: Cart retrieval
  // ============================================

  describe('Get Cart Functions', () => {
    test('should get active cart', async () => {
      const userId = 'user-1';
      const mockCart = {
        id: 'cart-1',
        userId,
        status: 'CART',
        user: { id: userId, email: 'test@example.com', name: 'Test User' },
      };

      prisma.order.findFirst.mockResolvedValue(mockCart);

      const result = await getActiveCart(userId);

      expect(result).toEqual(mockCart);
      expect(prisma.order.findFirst).toHaveBeenCalledWith({
        where: { userId, status: 'CART' },
        include: {
          user: { select: { id: true, email: true, name: true } },
        },
      });
    });

    test('should get checkout order', async () => {
      const userId = 'user-1';
      const mockCheckoutOrder = {
        id: 'order-1',
        userId,
        status: 'CHECKOUT',
        stockReservations: [{ id: 'res-1', status: 'ACTIVE' }],
      };

      prisma.order.findFirst.mockResolvedValue(mockCheckoutOrder);

      const result = await getCheckoutOrder(userId);

      expect(result).toEqual(mockCheckoutOrder);
      expect(prisma.order.findFirst).toHaveBeenCalledWith({
        where: { userId, status: 'CHECKOUT' },
        orderBy: { checkoutAt: 'desc' },
        include: {
          stockReservations: { where: { status: 'ACTIVE' } },
        },
      });
    });
  });

  // ============================================
  // TEST 9: Traceability
  // Criterion: Complete traceability 100%
  // ============================================

  describe('Traceability', () => {
    test('should create immutable snapshots with timestamps', async () => {
      const userId = 'user-1';
      const mockCart = {
        id: 'cart-1',
        userId,
        status: 'CART',
        version: 0,
        itemsSnapshot: [{ productId: 'prod-1', quantity: 1 }],
      };

      const mockProduct = {
        id: 'prod-1',
        name: 'Product 1',
        price: 10.00,
        stockAvailable: 10,
      };

      const mockPromoResult = {
        finalAmount: 10.00,
        totalDiscount: 0,
        appliedPromotions: [],
      };

      const mockCheckoutAt = new Date();

      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          order: {
            findFirst: jest.fn().mockResolvedValue(mockCart),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findUnique: jest.fn().mockResolvedValue({
              ...mockCart,
              version: 1,
              itemsSnapshot: [{ productId: 'prod-1', name: 'Product 1', priceSnapshot: 10.00, quantity: 1, subtotal: 10.00 }],
              totalSnapshot: 10.00,
              promoSnapshot: [],
              checkoutAt: mockCheckoutAt,
            }),
          },
          product: {
            findUnique: jest.fn().mockResolvedValue(mockProduct),
          },
        };

        return await callback(tx);
      });

      validateAndApplyPromotions.mockResolvedValue(mockPromoResult);

      const result = await createOrderFromCart(userId);

      expect(result.order.checkoutAt).toBeInstanceOf(Date);
      expect(result.order.itemsSnapshot).toBeDefined();
      expect(result.order.totalSnapshot).toBe(10.00);
      expect(result.order.promoSnapshot).toBeDefined();
    });
  });
});
