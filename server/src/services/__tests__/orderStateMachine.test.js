const { transitionOrderState, isTransitionAllowed, TRANSITIONS_MAP } = require('../orderStateMachine');

// Mock Prisma client
jest.mock('../../prisma', () => ({
  $transaction: jest.fn(),
  order: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
  stockReservation: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  },
  product: {
    update: jest.fn(),
  },
  orderStateAudit: {
    create: jest.fn(),
  },
}));

const prisma = require('../../prisma');

describe('OrderStateMachine - F4 Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================
  // TEST 1: Valid Transitions (Happy Path)
  // Criterion: Validate graph transitions 100%
  // ============================================

  describe('Valid Transitions', () => {
    test('should allow CART → CHECKOUT transition', async () => {
      const mockOrder = {
        id: 'order-1',
        status: 'CART',
        version: 1,
        paymentId: null,
      };

      prisma.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          order: {
            findUnique: jest.fn().mockResolvedValue(mockOrder),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          stockReservation: {
            findMany: jest.fn().mockResolvedValue([]),
            updateMany: jest.fn(),
          },
          orderStateAudit: {
            create: jest.fn().mockResolvedValue({}),
          },
        };

        const result = await callback(mockTx);
        return result;
      });

      const result = await transitionOrderState('order-1', 'CHECKOUT', 'USER_ACTION', 'user-123');

      expect(result.success).toBe(true);
      expect(result.idempotent).toBe(false);
    });

    test('should allow CHECKOUT → PAID transition with valid paymentId', async () => {
      const mockOrder = {
        id: 'order-2',
        status: 'CHECKOUT',
        version: 2,
        paymentId: 'payment-123',
      };

      const mockReservations = [
        { id: 'res-1', productId: 'prod-1', quantity: 2, status: 'ACTIVE' },
      ];

      prisma.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          order: {
            findUnique: jest.fn().mockResolvedValue(mockOrder),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          stockReservation: {
            findMany: jest.fn().mockResolvedValue(mockReservations),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          orderStateAudit: {
            create: jest.fn().mockResolvedValue({}),
          },
        };

        return await callback(mockTx);
      });

      const result = await transitionOrderState('order-2', 'PAID', 'PAYMENT_SUCCESS', 'SYSTEM');

      expect(result.success).toBe(true);
    });

    test('should allow CHECKOUT → CANCELLED transition', async () => {
      const mockOrder = {
        id: 'order-3',
        status: 'CHECKOUT',
        version: 1,
      };

      const mockReservations = [
        { id: 'res-1', productId: 'prod-1', quantity: 2, status: 'ACTIVE' },
      ];

      prisma.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          order: {
            findUnique: jest.fn().mockResolvedValue(mockOrder),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          stockReservation: {
            findMany: jest.fn().mockResolvedValue(mockReservations),
            update: jest.fn().mockResolvedValue({}),
          },
          product: {
            update: jest.fn().mockResolvedValue({}),
          },
          orderStateAudit: {
            create: jest.fn().mockResolvedValue({}),
          },
        };

        return await callback(mockTx);
      });

      const result = await transitionOrderState('order-3', 'CANCELLED', 'USER_CANCEL', 'user-456');

      expect(result.success).toBe(true);
    });
  });

  // ============================================
  // TEST 2: Invalid Transitions (Graph Validation)
  // Criterion: Validate graph transitions 100%
  // ============================================

  describe('Invalid Transitions', () => {
    test('should reject CART → PAID transition (skip CHECKOUT)', async () => {
      const mockOrder = {
        id: 'order-4',
        status: 'CART',
        version: 1,
      };

      prisma.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          order: {
            findUnique: jest.fn().mockResolvedValue(mockOrder),
          },
        };

        return await callback(mockTx);
      });

      await expect(
        transitionOrderState('order-4', 'PAID', 'INVALID', 'SYSTEM')
      ).rejects.toThrow('INVALID_TRANSITION: CART → PAID not allowed');
    });

    test('should reject transition from terminal state DELIVERED', async () => {
      const mockOrder = {
        id: 'order-5',
        status: 'DELIVERED',
        version: 5,
      };

      prisma.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          order: {
            findUnique: jest.fn().mockResolvedValue(mockOrder),
          },
        };

        return await callback(mockTx);
      });

      await expect(
        transitionOrderState('order-5', 'PREPARING', 'INVALID', 'SYSTEM')
      ).rejects.toThrow('INVALID_TRANSITION');
    });

    test('should reject transition from terminal state CANCELLED', async () => {
      const mockOrder = {
        id: 'order-6',
        status: 'CANCELLED',
        version: 3,
      };

      prisma.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          order: {
            findUnique: jest.fn().mockResolvedValue(mockOrder),
          },
        };

        return await callback(mockTx);
      });

      await expect(
        transitionOrderState('order-6', 'CHECKOUT', 'INVALID', 'SYSTEM')
      ).rejects.toThrow('INVALID_TRANSITION');
    });
  });

  // ============================================
  // TEST 3: Preconditions Validation
  // Criterion: Preconditions validated 100%
  // ============================================

  describe('Preconditions Validation', () => {
    test('should reject CHECKOUT → PAID without paymentId', async () => {
      const mockOrder = {
        id: 'order-7',
        status: 'CHECKOUT',
        version: 2,
        paymentId: null, // Missing payment
      };

      prisma.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          order: {
            findUnique: jest.fn().mockResolvedValue(mockOrder),
          },
        };

        return await callback(mockTx);
      });

      await expect(
        transitionOrderState('order-7', 'PAID', 'PAYMENT_SUCCESS', 'SYSTEM')
      ).rejects.toThrow('PRECONDITION_FAILED: PAID state requires paymentId');
    });

    test('should reject PAID → PREPARING without active stock reservations', async () => {
      const mockOrder = {
        id: 'order-8',
        status: 'PAID',
        version: 3,
        paymentId: 'payment-456',
      };

      prisma.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          order: {
            findUnique: jest.fn().mockResolvedValue(mockOrder),
          },
          stockReservation: {
            findMany: jest.fn().mockResolvedValue([]), // No reservations
          },
        };

        return await callback(mockTx);
      });

      await expect(
        transitionOrderState('order-8', 'PREPARING', 'START_PREPARING', 'SYSTEM')
      ).rejects.toThrow('PRECONDITION_FAILED: PREPARING state requires active stock reservations');
    });
  });

  // ============================================
  // TEST 4: Idempotence
  // Criterion: Idempotence transitions 100%
  // ============================================

  describe('Idempotence', () => {
    test('should return success if order already in target state', async () => {
      const mockOrder = {
        id: 'order-9',
        status: 'PAID',
        version: 3,
      };

      prisma.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          order: {
            findUnique: jest.fn().mockResolvedValue(mockOrder),
          },
        };

        return await callback(mockTx);
      });

      const result = await transitionOrderState('order-9', 'PAID', 'RETRY', 'SYSTEM');

      expect(result.success).toBe(true);
      expect(result.idempotent).toBe(true);
    });
  });

  // ============================================
  // TEST 5: Optimistic Lock (Concurrent Modifications)
  // Criterion: Detect race conditions 100%
  // ============================================

  describe('Optimistic Lock', () => {
    test('should reject concurrent modification (version mismatch)', async () => {
      const mockOrder = {
        id: 'order-10',
        status: 'CHECKOUT',
        version: 2,
        paymentId: 'payment-789',
      };

      prisma.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          order: {
            findUnique: jest.fn().mockResolvedValue(mockOrder),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }), // Version mismatch
          },
          stockReservation: {
            findMany: jest.fn().mockResolvedValue([
              { id: 'res-1', productId: 'prod-1', quantity: 1, status: 'ACTIVE' },
            ]),
            updateMany: jest.fn(),
          },
        };

        return await callback(mockTx);
      });

      await expect(
        transitionOrderState('order-10', 'PAID', 'PAYMENT_SUCCESS', 'SYSTEM')
      ).rejects.toThrow('CONCURRENT_MODIFICATION');
    });
  });

  // ============================================
  // TEST 6: Audit Log Creation
  // Criterion: Traceability audit log 100%
  // ============================================

  describe('Audit Log', () => {
    test('should create audit log entry on successful transition', async () => {
      const mockOrder = {
        id: 'order-11',
        status: 'CART',
        version: 1,
      };

      const mockAuditCreate = jest.fn().mockResolvedValue({});

      prisma.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          order: {
            findUnique: jest.fn().mockResolvedValue(mockOrder),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          stockReservation: {
            findMany: jest.fn().mockResolvedValue([]),
          },
          orderStateAudit: {
            create: mockAuditCreate,
          },
        };

        return await callback(mockTx);
      });

      await transitionOrderState('order-11', 'CHECKOUT', 'USER_CHECKOUT', 'user-789');

      expect(mockAuditCreate).toHaveBeenCalledWith({
        data: {
          orderId: 'order-11',
          fromState: 'CART',
          toState: 'CHECKOUT',
          reason: 'USER_CHECKOUT',
          actor: 'user-789',
        },
      });
    });
  });

  // ============================================
  // TEST 7: Critical Side Effects (Stock Release on CANCELLED)
  // Criterion: Atomicity transitions 100%
  // ============================================

  describe('Critical Side Effects', () => {
    test('should release stock when transitioning to CANCELLED', async () => {
      const mockOrder = {
        id: 'order-12',
        status: 'CHECKOUT',
        version: 2,
      };

      const mockReservations = [
        { id: 'res-1', productId: 'prod-1', quantity: 3, status: 'ACTIVE' },
        { id: 'res-2', productId: 'prod-2', quantity: 1, status: 'ACTIVE' },
      ];

      const mockProductUpdate = jest.fn().mockResolvedValue({});
      const mockReservationUpdate = jest.fn().mockResolvedValue({});

      prisma.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          order: {
            findUnique: jest.fn().mockResolvedValue(mockOrder),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          stockReservation: {
            findMany: jest.fn().mockResolvedValue(mockReservations),
            update: mockReservationUpdate,
          },
          product: {
            update: mockProductUpdate,
          },
          orderStateAudit: {
            create: jest.fn().mockResolvedValue({}),
          },
        };

        return await callback(mockTx);
      });

      await transitionOrderState('order-12', 'CANCELLED', 'TIMEOUT', 'SYSTEM');

      // Verify stock was released for each reservation
      expect(mockProductUpdate).toHaveBeenCalledTimes(2);
      expect(mockProductUpdate).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: {
          stockAvailable: { increment: 3 },
          stockReserved: { decrement: 3 },
        },
      });

      // Verify reservations were marked as RELEASED
      expect(mockReservationUpdate).toHaveBeenCalledTimes(2);
    });

    test('should confirm stock reservations when transitioning to PAID', async () => {
      const mockOrder = {
        id: 'order-13',
        status: 'CHECKOUT',
        version: 2,
        paymentId: 'payment-999',
      };

      const mockReservations = [
        { id: 'res-1', productId: 'prod-1', quantity: 2, status: 'ACTIVE' },
      ];

      const mockReservationUpdateMany = jest.fn().mockResolvedValue({ count: 1 });

      prisma.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          order: {
            findUnique: jest.fn().mockResolvedValue(mockOrder),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          stockReservation: {
            findMany: jest.fn().mockResolvedValue(mockReservations),
            updateMany: mockReservationUpdateMany,
          },
          orderStateAudit: {
            create: jest.fn().mockResolvedValue({}),
          },
        };

        return await callback(mockTx);
      });

      await transitionOrderState('order-13', 'PAID', 'PAYMENT_SUCCESS', 'SYSTEM');

      // Verify reservations were confirmed
      expect(mockReservationUpdateMany).toHaveBeenCalledWith({
        where: {
          orderId: 'order-13',
          status: 'ACTIVE',
        },
        data: {
          status: 'CONFIRMED',
        },
      });
    });
  });

  // ============================================
  // TEST 8: Order Not Found
  // Criterion: Error handling
  // ============================================

  describe('Error Handling', () => {
    test('should throw error if order not found', async () => {
      prisma.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          order: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        };

        return await callback(mockTx);
      });

      await expect(
        transitionOrderState('non-existent', 'CHECKOUT', 'INVALID', 'SYSTEM')
      ).rejects.toThrow('ORDER_NOT_FOUND');
    });
  });

  // ============================================
  // TEST 9: TRANSITIONS_MAP Validation
  // Criterion: Graph structure validation
  // ============================================

  describe('TRANSITIONS_MAP Structure', () => {
    test('should have correct allowed transitions for CART', () => {
      expect(TRANSITIONS_MAP.CART).toEqual(['CHECKOUT', 'CANCELLED']);
    });

    test('should have correct allowed transitions for CHECKOUT', () => {
      expect(TRANSITIONS_MAP.CHECKOUT).toEqual(['PAID', 'CANCELLED']);
    });

    test('should have correct allowed transitions for PAID', () => {
      expect(TRANSITIONS_MAP.PAID).toEqual(['PREPARING', 'CANCELLED']);
    });

    test('should have no transitions from terminal states', () => {
      expect(TRANSITIONS_MAP.DELIVERED).toEqual([]);
      expect(TRANSITIONS_MAP.CANCELLED).toEqual([]);
    });
  });

  // ============================================
  // TEST 10: isTransitionAllowed Helper
  // Criterion: Validation function correctness
  // ============================================

  describe('isTransitionAllowed Helper', () => {
    test('should return true for valid transition', () => {
      expect(isTransitionAllowed('CART', 'CHECKOUT')).toBe(true);
      expect(isTransitionAllowed('CHECKOUT', 'PAID')).toBe(true);
    });

    test('should return false for invalid transition', () => {
      expect(isTransitionAllowed('CART', 'PAID')).toBe(false);
      expect(isTransitionAllowed('DELIVERED', 'CHECKOUT')).toBe(false);
    });

    test('should return false for non-existent state', () => {
      expect(isTransitionAllowed('INVALID_STATE', 'CHECKOUT')).toBe(false);
    });
  });
});
