const {
  reserveStock,
  releaseStock,
  getActiveReservations,
  isReservationExpired,
  extendReservation,
  DEFAULT_RESERVATION_DURATION,
} = require('../stockReservationService');

// Mock Prisma client
jest.mock('../../prisma', () => ({
  $transaction: jest.fn(),
  stockReservation: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  product: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
}));

const prisma = require('../../prisma');

describe('StockReservationService - F3 Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================
  // TEST 1: Stock Reservation (Happy Path)
  // Criterion: Taux réussite réservation ≥99%
  // ============================================

  describe('Stock Reservation', () => {
    test('should reserve stock successfully with valid items', async () => {
      const orderId = 'order-1';
      const items = [
        { productId: 'prod-1', quantity: 2 },
        { productId: 'prod-2', quantity: 1 },
      ];

      prisma.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          stockReservation: {
            findFirst: jest.fn().mockResolvedValue(null), // No existing reservation
            create: jest.fn()
              .mockResolvedValueOnce({
                id: 'res-1',
                orderId,
                productId: 'prod-1',
                quantity: 2,
                expiresAt: new Date(Date.now() + DEFAULT_RESERVATION_DURATION),
                status: 'ACTIVE',
              })
              .mockResolvedValueOnce({
                id: 'res-2',
                orderId,
                productId: 'prod-2',
                quantity: 1,
                expiresAt: new Date(Date.now() + DEFAULT_RESERVATION_DURATION),
                status: 'ACTIVE',
              }),
          },
          product: {
            findUnique: jest.fn()
              .mockResolvedValueOnce({
                id: 'prod-1',
                stockAvailable: 10,
                stockReserved: 0,
                stockTotal: 10,
              })
              .mockResolvedValueOnce({
                id: 'prod-2',
                stockAvailable: 5,
                stockReserved: 0,
                stockTotal: 5,
              }),
            update: jest.fn().mockResolvedValue({}),
          },
        };

        return await callback(mockTx);
      });

      const result = await reserveStock(orderId, items);

      expect(result.success).toBe(true);
      expect(result.idempotent).toBe(false);
      expect(result.reservations).toHaveLength(2);
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    test('should create reservations with correct expiration time', async () => {
      const orderId = 'order-2';
      const items = [{ productId: 'prod-1', quantity: 1 }];
      const customDuration = 15 * 60 * 1000; // 15 minutes

      prisma.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          stockReservation: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({
              id: 'res-1',
              orderId,
              productId: 'prod-1',
              quantity: 1,
              expiresAt: new Date(Date.now() + customDuration),
              status: 'ACTIVE',
            }),
          },
          product: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'prod-1',
              stockAvailable: 10,
              stockReserved: 0,
              stockTotal: 10,
            }),
            update: jest.fn().mockResolvedValue({}),
          },
        };

        return await callback(mockTx);
      });

      const result = await reserveStock(orderId, items, customDuration);

      expect(result.success).toBe(true);
      const timeDiff = result.expiresAt.getTime() - Date.now();
      expect(timeDiff).toBeGreaterThan(14 * 60 * 1000); // At least 14min
      expect(timeDiff).toBeLessThan(16 * 60 * 1000); // At most 16min
    });
  });

  // ============================================
  // TEST 2: Idempotence
  // Criterion: Idempotence réservation 100%
  // ============================================

  describe('Idempotence', () => {
    test('should return existing reservation if order already reserved', async () => {
      const orderId = 'order-3';
      const items = [{ productId: 'prod-1', quantity: 2 }];

      const existingReservation = {
        id: 'res-existing',
        orderId,
        productId: 'prod-1',
        quantity: 2,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        status: 'ACTIVE',
      };

      prisma.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          stockReservation: {
            findFirst: jest.fn().mockResolvedValue(existingReservation),
            findMany: jest.fn().mockResolvedValue([existingReservation]),
          },
        };

        return await callback(mockTx);
      });

      const result = await reserveStock(orderId, items);

      expect(result.success).toBe(true);
      expect(result.idempotent).toBe(true);
      expect(result.reservations).toHaveLength(1);
      expect(result.reservations[0].id).toBe('res-existing');
    });
  });

  // ============================================
  // TEST 3: Stock Availability Validation
  // Criterion: Détection sur-réservation 100%
  // ============================================

  describe('Stock Availability Validation', () => {
    test('should reject reservation when insufficient stock', async () => {
      const orderId = 'order-4';
      const items = [{ productId: 'prod-1', quantity: 10 }]; // Request 10

      prisma.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          stockReservation: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          product: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'prod-1',
              stockAvailable: 5, // Only 5 available
              stockReserved: 0,
              stockTotal: 5,
            }),
          },
        };

        return await callback(mockTx);
      });

      await expect(reserveStock(orderId, items)).rejects.toThrow('INSUFFICIENT_STOCK');
    });

    test('should reject reservation when product not found', async () => {
      const orderId = 'order-5';
      const items = [{ productId: 'nonexistent', quantity: 1 }];

      prisma.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          stockReservation: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          product: {
            findUnique: jest.fn().mockResolvedValue(null), // Product not found
          },
        };

        return await callback(mockTx);
      });

      await expect(reserveStock(orderId, items)).rejects.toThrow('INSUFFICIENT_STOCK');
    });

    test('should reject reservation with negative quantity', async () => {
      const orderId = 'order-6';
      const items = [{ productId: 'prod-1', quantity: -1 }];

      await expect(reserveStock(orderId, items)).rejects.toThrow('INVALID_QUANTITY');
    });

    test('should reject reservation with zero quantity', async () => {
      const orderId = 'order-7';
      const items = [{ productId: 'prod-1', quantity: 0 }];

      await expect(reserveStock(orderId, items)).rejects.toThrow('INVALID_QUANTITY');
    });

    test('should reject reservation with empty items array', async () => {
      const orderId = 'order-8';
      const items = [];

      await expect(reserveStock(orderId, items)).rejects.toThrow('INVALID_ITEMS');
    });
  });

  // ============================================
  // TEST 4: Atomicity - Stock Updates
  // Criterion: Exactitude stock 100% (available + reserved = total)
  // ============================================

  describe('Atomic Stock Updates', () => {
    test('should decrement stockAvailable and increment stockReserved atomically', async () => {
      const orderId = 'order-9';
      const items = [{ productId: 'prod-1', quantity: 3 }];

      const mockProductUpdate = jest.fn().mockResolvedValue({});

      prisma.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          stockReservation: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({
              id: 'res-1',
              orderId,
              productId: 'prod-1',
              quantity: 3,
              expiresAt: new Date(),
              status: 'ACTIVE',
            }),
          },
          product: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'prod-1',
              stockAvailable: 10,
              stockReserved: 0,
              stockTotal: 10,
            }),
            update: mockProductUpdate,
          },
        };

        return await callback(mockTx);
      });

      await reserveStock(orderId, items);

      // Verify atomic update: decrement available, increment reserved
      expect(mockProductUpdate).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: {
          stockAvailable: { decrement: 3 },
          stockReserved: { increment: 3 },
        },
      });
    });
  });

  // ============================================
  // TEST 5: Stock Release (Happy Path)
  // Criterion: Libération immédiate 100%
  // ============================================

  describe('Stock Release', () => {
    test('should release stock successfully', async () => {
      const orderId = 'order-10';

      const mockReservations = [
        { id: 'res-1', orderId, productId: 'prod-1', quantity: 2, status: 'ACTIVE' },
        { id: 'res-2', orderId, productId: 'prod-2', quantity: 1, status: 'ACTIVE' },
      ];

      const mockProductUpdate = jest.fn().mockResolvedValue({});
      const mockReservationUpdate = jest.fn().mockResolvedValue({});

      prisma.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          stockReservation: {
            findMany: jest.fn().mockResolvedValue(mockReservations),
            update: mockReservationUpdate,
          },
          product: {
            update: mockProductUpdate,
          },
        };

        return await callback(mockTx);
      });

      const result = await releaseStock(orderId, 'CANCELLED');

      expect(result.success).toBe(true);
      expect(result.idempotent).toBe(false);
      expect(result.releasedCount).toBe(2);

      // Verify both products were updated
      expect(mockProductUpdate).toHaveBeenCalledTimes(2);
      expect(mockReservationUpdate).toHaveBeenCalledTimes(2);
    });

    test('should increment stockAvailable and decrement stockReserved atomically', async () => {
      const orderId = 'order-11';

      const mockReservations = [
        { id: 'res-1', orderId, productId: 'prod-1', quantity: 5, status: 'ACTIVE' },
      ];

      const mockProductUpdate = jest.fn().mockResolvedValue({});

      prisma.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          stockReservation: {
            findMany: jest.fn().mockResolvedValue(mockReservations),
            update: jest.fn().mockResolvedValue({}),
          },
          product: {
            update: mockProductUpdate,
          },
        };

        return await callback(mockTx);
      });

      await releaseStock(orderId, 'EXPIRED');

      // Verify atomic update: increment available, decrement reserved
      expect(mockProductUpdate).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: {
          stockAvailable: { increment: 5 },
          stockReserved: { decrement: 5 },
        },
      });
    });
  });

  // ============================================
  // TEST 6: Release Idempotence
  // Criterion: Idempotence libération 100%
  // ============================================

  describe('Release Idempotence', () => {
    test('should return success if no active reservations to release', async () => {
      const orderId = 'order-12';

      prisma.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          stockReservation: {
            findMany: jest.fn().mockResolvedValue([]), // No active reservations
          },
        };

        return await callback(mockTx);
      });

      const result = await releaseStock(orderId, 'MANUAL');

      expect(result.success).toBe(true);
      expect(result.idempotent).toBe(true);
      expect(result.releasedCount).toBe(0);
    });
  });

  // ============================================
  // TEST 7: Get Active Reservations
  // Criterion: Traçabilité complète 100%
  // ============================================

  describe('Get Active Reservations', () => {
    test('should return active reservations with product details', async () => {
      const orderId = 'order-13';

      prisma.stockReservation.findMany.mockResolvedValue([
        {
          id: 'res-1',
          orderId,
          productId: 'prod-1',
          quantity: 2,
          status: 'ACTIVE',
          expiresAt: new Date(),
          product: {
            id: 'prod-1',
            name: 'Product 1',
            stockAvailable: 8,
            stockReserved: 2,
            stockTotal: 10,
          },
        },
      ]);

      const result = await getActiveReservations(orderId);

      expect(result).toHaveLength(1);
      expect(result[0].product.name).toBe('Product 1');
    });

    test('should return empty array if no active reservations', async () => {
      const orderId = 'order-14';

      prisma.stockReservation.findMany.mockResolvedValue([]);

      const result = await getActiveReservations(orderId);

      expect(result).toEqual([]);
    });
  });

  // ============================================
  // TEST 8: Check Reservation Expiration
  // Criterion: Libération expiration ≤2min
  // ============================================

  describe('Check Reservation Expiration', () => {
    test('should return true if reservation is expired', async () => {
      const orderId = 'order-15';
      const pastDate = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago

      prisma.stockReservation.findFirst.mockResolvedValue({
        id: 'res-1',
        orderId,
        expiresAt: pastDate,
        status: 'ACTIVE',
      });

      const result = await isReservationExpired(orderId);

      expect(result).toBe(true);
    });

    test('should return false if reservation is not expired', async () => {
      const orderId = 'order-16';
      const futureDate = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

      prisma.stockReservation.findFirst.mockResolvedValue({
        id: 'res-1',
        orderId,
        expiresAt: futureDate,
        status: 'ACTIVE',
      });

      const result = await isReservationExpired(orderId);

      expect(result).toBe(false);
    });

    test('should return false if no active reservation', async () => {
      const orderId = 'order-17';

      prisma.stockReservation.findFirst.mockResolvedValue(null);

      const result = await isReservationExpired(orderId);

      expect(result).toBe(false);
    });
  });

  // ============================================
  // TEST 9: Extend Reservation
  // Criterion: Durée expiration adaptative
  // ============================================

  describe('Extend Reservation', () => {
    test('should extend reservation expiration time', async () => {
      const orderId = 'order-18';
      const oldExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 min
      const additionalTime = 10 * 60 * 1000; // Add 10 min

      prisma.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          stockReservation: {
            findMany: jest.fn().mockResolvedValue([
              { id: 'res-1', orderId, expiresAt: oldExpires, status: 'ACTIVE' },
            ]),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        };

        return await callback(mockTx);
      });

      const result = await extendReservation(orderId, additionalTime);

      expect(result.success).toBe(true);
      expect(result.oldExpiresAt).toEqual(oldExpires);
      expect(result.newExpiresAt.getTime()).toBe(oldExpires.getTime() + additionalTime);
    });

    test('should throw error if no active reservation to extend', async () => {
      const orderId = 'order-19';

      prisma.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          stockReservation: {
            findMany: jest.fn().mockResolvedValue([]), // No active reservation
          },
        };

        return await callback(mockTx);
      });

      await expect(extendReservation(orderId, 10000)).rejects.toThrow('NO_ACTIVE_RESERVATION');
    });
  });

  // ============================================
  // TEST 10: Multiple Items Reservation
  // Criterion: Atomicité - Rollback on failure
  // ============================================

  describe('Multiple Items Atomicity', () => {
    test('should reserve all items or none (atomic transaction)', async () => {
      const orderId = 'order-20';
      const items = [
        { productId: 'prod-1', quantity: 2 },
        { productId: 'prod-2', quantity: 10 }, // Insufficient stock
      ];

      prisma.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          stockReservation: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          product: {
            findUnique: jest.fn()
              .mockResolvedValueOnce({
                id: 'prod-1',
                stockAvailable: 10,
                stockReserved: 0,
                stockTotal: 10,
              })
              .mockResolvedValueOnce({
                id: 'prod-2',
                stockAvailable: 5, // Only 5 available, but requesting 10
                stockReserved: 0,
                stockTotal: 5,
              }),
          },
        };

        return await callback(mockTx);
      });

      // Should throw error, and no partial reservation should occur
      await expect(reserveStock(orderId, items)).rejects.toThrow('INSUFFICIENT_STOCK');
    });
  });
});
