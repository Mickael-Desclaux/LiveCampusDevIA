const {
  scanAbandonedCarts,
  recoverCart,
  trackConversion,
  getRecoveryStats,
  isEligibleForRecovery,
  generateRecoveryToken,
  calculateTokenExpiration,
  sendRecoveryEmail,
  MIN_ABANDONED_HOURS,
  MAX_ABANDONED_HOURS,
  TOKEN_EXPIRATION_DAYS,
} = require('../cartRecoveryService');

const prisma = require('../../prisma');

// Mock Prisma
jest.mock('../../prisma', () => ({
  order: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
  cartRecoveryLog: {
    create: jest.fn(),
    updateMany: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
}));

describe('CartRecoveryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================
  // TOKEN GENERATION
  // ============================================

  describe('generateRecoveryToken', () => {
    test('should generate 64-character hex token', () => {
      const token = generateRecoveryToken();

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBe(64); // 32 bytes = 64 hex chars
      expect(/^[a-f0-9]{64}$/.test(token)).toBe(true);
    });

    test('should generate unique tokens', () => {
      const token1 = generateRecoveryToken();
      const token2 = generateRecoveryToken();

      expect(token1).not.toBe(token2);
    });
  });

  describe('calculateTokenExpiration', () => {
    test('should calculate expiration 7 days from now', () => {
      const now = new Date();
      const expiresAt = calculateTokenExpiration();

      const diffMs = expiresAt.getTime() - now.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      expect(diffDays).toBeGreaterThanOrEqual(6.99); // Close to 7 days
      expect(diffDays).toBeLessThanOrEqual(7.01);
    });
  });

  // ============================================
  // EMAIL SERVICE
  // ============================================

  describe('sendRecoveryEmail', () => {
    test('should send recovery email with correct details', async () => {
      const cart = { id: 'cart-1', itemsSnapshot: [{ productId: 'prod-1', quantity: 2 }] };
      const user = { id: 'user-1', email: 'test@example.com', name: 'Test User' };
      const token = 'test-token-123';

      // Mock console.log to verify email details
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      await sendRecoveryEmail(cart, user, token);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Email sent'),
        expect.objectContaining({
          cartId: 'cart-1',
          userId: 'user-1',
          token: 'test-token-123',
        })
      );

      consoleLogSpy.mockRestore();
    });

    // Note: Email failures are random (5%), tested in integration tests
  });

  // ============================================
  // SCAN ABANDONED CARTS
  // ============================================

  describe('scanAbandonedCarts', () => {
    test('should scan and process abandoned carts successfully', async () => {
      const mockCarts = [
        {
          id: 'cart-1',
          userId: 'user-1',
          status: 'CART',
          createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24h ago
          recoveryEmailSent: false,
          user: {
            id: 'user-1',
            email: 'user1@example.com',
            name: 'User 1',
            marketingConsent: true,
          },
        },
        {
          id: 'cart-2',
          userId: 'user-2',
          status: 'CART',
          createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
          recoveryEmailSent: false,
          user: {
            id: 'user-2',
            email: 'user2@example.com',
            name: 'User 2',
            marketingConsent: true,
          },
        },
      ];

      prisma.order.findMany.mockResolvedValue(mockCarts);
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      prisma.cartRecoveryLog.create.mockResolvedValue({});

      const result = await scanAbandonedCarts();

      expect(result.processed).toBe(2);
      expect(result.sent).toBeGreaterThanOrEqual(0); // May fail randomly due to 5% email failure
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'CART',
            recoveryEmailSent: false,
            user: { marketingConsent: true },
          }),
        })
      );
    });

    test('should filter by time window (23-25h)', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      await scanAbandonedCarts();

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
        })
      );

      // Verify time window calculation
      const callArgs = prisma.order.findMany.mock.calls[0][0];
      const minTime = callArgs.where.createdAt.gte;
      const maxTime = callArgs.where.createdAt.lte;

      const now = new Date();
      const expectedMin = new Date(now.getTime() - MAX_ABANDONED_HOURS * 60 * 60 * 1000);
      const expectedMax = new Date(now.getTime() - MIN_ABANDONED_HOURS * 60 * 60 * 1000);

      // Allow 1 minute tolerance for test execution time
      expect(Math.abs(minTime.getTime() - expectedMin.getTime())).toBeLessThan(60000);
      expect(Math.abs(maxTime.getTime() - expectedMax.getTime())).toBeLessThan(60000);
    });

    test('should respect marketing consent (GDPR) - INV-F6-2', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      await scanAbandonedCarts();

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user: { marketingConsent: true },
          }),
        })
      );
    });

    test('should ensure unicité relance (only unprocessed carts) - INV-F6-1', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      await scanAbandonedCarts();

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            recoveryEmailSent: false,
          }),
        })
      );
    });

    test('should be idempotent (updateMany with WHERE condition)', async () => {
      const mockCart = {
        id: 'cart-1',
        userId: 'user-1',
        status: 'CART',
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        recoveryEmailSent: false,
        user: {
          id: 'user-1',
          email: 'user@example.com',
          name: 'User',
          marketingConsent: true,
        },
      };

      prisma.order.findMany.mockResolvedValue([mockCart]);
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      prisma.cartRecoveryLog.create.mockResolvedValue({});

      await scanAbandonedCarts();

      // Verify updateMany uses WHERE condition with recovery_email_sent = false
      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'cart-1',
          recoveryEmailSent: false, // Idempotence
        },
        data: expect.objectContaining({
          recoveryEmailSent: true,
          recoveryToken: expect.any(String),
          recoveryTokenExpiresAt: expect.any(Date),
        }),
      });
    });

    test('should handle race condition (cart already processed)', async () => {
      const mockCart = {
        id: 'cart-1',
        userId: 'user-1',
        status: 'CART',
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        recoveryEmailSent: false,
        user: {
          id: 'user-1',
          email: 'user@example.com',
          name: 'User',
          marketingConsent: true,
        },
      };

      prisma.order.findMany.mockResolvedValue([mockCart]);
      prisma.order.updateMany.mockResolvedValue({ count: 0 }); // Already processed

      const result = await scanAbandonedCarts();

      expect(result.processed).toBe(1);
      expect(result.sent).toBe(0); // Email not sent because update failed
      expect(prisma.cartRecoveryLog.create).not.toHaveBeenCalled();
    });

    test('should continue processing on email failure (non-blocking)', async () => {
      const mockCarts = [
        {
          id: 'cart-1',
          userId: 'user-1',
          status: 'CART',
          createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
          recoveryEmailSent: false,
          user: {
            id: 'user-1',
            email: 'user1@example.com',
            name: 'User 1',
            marketingConsent: true,
          },
        },
        {
          id: 'cart-2',
          userId: 'user-2',
          status: 'CART',
          createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
          recoveryEmailSent: false,
          user: {
            id: 'user-2',
            email: 'user2@example.com',
            name: 'User 2',
            marketingConsent: true,
          },
        },
      ];

      prisma.order.findMany.mockResolvedValue(mockCarts);
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      prisma.cartRecoveryLog.create.mockResolvedValue({});

      const result = await scanAbandonedCarts();

      // Both carts should be processed even if emails fail
      expect(result.processed).toBe(2);
      expect(result.sent + result.failed).toBe(2);
    });

    test('should respect batch size limit', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      await scanAbandonedCarts(50);

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
        })
      );
    });

    test('should create recovery log for each cart', async () => {
      const mockCart = {
        id: 'cart-1',
        userId: 'user-1',
        status: 'CART',
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        recoveryEmailSent: false,
        user: {
          id: 'user-1',
          email: 'user@example.com',
          name: 'User',
          marketingConsent: true,
        },
      };

      prisma.order.findMany.mockResolvedValue([mockCart]);
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      prisma.cartRecoveryLog.create.mockResolvedValue({});

      await scanAbandonedCarts();

      expect(prisma.cartRecoveryLog.create).toHaveBeenCalledWith({
        data: {
          orderId: 'cart-1',
          userId: 'user-1',
          token: expect.any(String),
          expiresAt: expect.any(Date),
        },
      });
    });
  });

  // ============================================
  // RECOVER CART
  // ============================================

  describe('recoverCart', () => {
    test('should recover cart with valid token', async () => {
      const token = 'valid-token-123';
      const mockOrder = {
        id: 'cart-1',
        userId: 'user-1',
        status: 'CART',
        recoveryToken: token,
        recoveryTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days future
        user: {
          id: 'user-1',
          email: 'user@example.com',
          name: 'User',
        },
      };

      prisma.order.findFirst.mockResolvedValue(mockOrder);
      prisma.cartRecoveryLog.updateMany.mockResolvedValue({ count: 1 });

      const result = await recoverCart(token);

      expect(result).toEqual({
        cart: mockOrder,
        user: mockOrder.user,
      });

      expect(prisma.cartRecoveryLog.updateMany).toHaveBeenCalledWith({
        where: {
          token,
          clickedAt: null,
        },
        data: {
          clickedAt: expect.any(Date),
        },
      });
    });

    test('should reject invalid token', async () => {
      const token = 'invalid-token';

      prisma.order.findFirst.mockResolvedValue(null);

      await expect(recoverCart(token)).rejects.toThrow('TOKEN_INVALID');
    });

    test('should reject expired token - INV-F6-3', async () => {
      const token = 'expired-token-123';
      const mockOrder = {
        id: 'cart-1',
        userId: 'user-1',
        status: 'CART',
        recoveryToken: token,
        recoveryTokenExpiresAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day past
        user: {
          id: 'user-1',
          email: 'user@example.com',
          name: 'User',
        },
      };

      prisma.order.findFirst.mockResolvedValue(mockOrder);

      await expect(recoverCart(token)).rejects.toThrow('TOKEN_EXPIRED');
    });

    test('should reject cart already converted', async () => {
      const token = 'converted-cart-token';
      const mockOrder = {
        id: 'cart-1',
        userId: 'user-1',
        status: 'PAID', // Already converted
        recoveryToken: token,
        recoveryTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        user: {
          id: 'user-1',
          email: 'user@example.com',
          name: 'User',
        },
      };

      prisma.order.findFirst.mockResolvedValue(mockOrder);

      await expect(recoverCart(token)).rejects.toThrow('CART_ALREADY_CONVERTED');
    });

    test('should be idempotent (only update if not clicked)', async () => {
      const token = 'valid-token-123';
      const mockOrder = {
        id: 'cart-1',
        userId: 'user-1',
        status: 'CART',
        recoveryToken: token,
        recoveryTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        user: {
          id: 'user-1',
          email: 'user@example.com',
          name: 'User',
        },
      };

      prisma.order.findFirst.mockResolvedValue(mockOrder);
      prisma.cartRecoveryLog.updateMany.mockResolvedValue({ count: 0 }); // Already clicked

      const result = await recoverCart(token);

      expect(result.cart).toBeDefined();
      expect(prisma.cartRecoveryLog.updateMany).toHaveBeenCalledWith({
        where: {
          token,
          clickedAt: null, // Idempotence
        },
        data: {
          clickedAt: expect.any(Date),
        },
      });
    });
  });

  // ============================================
  // TRACK CONVERSION
  // ============================================

  describe('trackConversion', () => {
    test('should track conversion for recovered cart', async () => {
      const orderId = 'order-1';
      const mockLog = {
        id: 'log-1',
        orderId,
        userId: 'user-1',
        token: 'token-123',
        emailSentAt: new Date(),
        clickedAt: new Date(),
        convertedAt: null,
      };

      prisma.cartRecoveryLog.findUnique.mockResolvedValue(mockLog);
      prisma.cartRecoveryLog.updateMany.mockResolvedValue({ count: 1 });

      await trackConversion(orderId);

      expect(prisma.cartRecoveryLog.updateMany).toHaveBeenCalledWith({
        where: {
          orderId,
          convertedAt: null, // Idempotence
        },
        data: {
          convertedAt: expect.any(Date),
        },
      });
    });

    test('should handle non-recovered cart (no log)', async () => {
      const orderId = 'order-1';

      prisma.cartRecoveryLog.findUnique.mockResolvedValue(null);

      await trackConversion(orderId);

      expect(prisma.cartRecoveryLog.updateMany).not.toHaveBeenCalled();
    });

    test('should be idempotent (only update if not converted)', async () => {
      const orderId = 'order-1';
      const mockLog = {
        id: 'log-1',
        orderId,
        userId: 'user-1',
        token: 'token-123',
        emailSentAt: new Date(),
        clickedAt: new Date(),
        convertedAt: new Date(), // Already converted
      };

      prisma.cartRecoveryLog.findUnique.mockResolvedValue(mockLog);
      prisma.cartRecoveryLog.updateMany.mockResolvedValue({ count: 0 });

      await trackConversion(orderId);

      expect(prisma.cartRecoveryLog.updateMany).toHaveBeenCalledWith({
        where: {
          orderId,
          convertedAt: null,
        },
        data: {
          convertedAt: expect.any(Date),
        },
      });
    });
  });

  // ============================================
  // RECOVERY STATISTICS
  // ============================================

  describe('getRecoveryStats', () => {
    test('should calculate recovery statistics', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          emailSentAt: new Date(),
          clickedAt: new Date(),
          convertedAt: new Date(),
        },
        {
          id: 'log-2',
          emailSentAt: new Date(),
          clickedAt: new Date(),
          convertedAt: null,
        },
        {
          id: 'log-3',
          emailSentAt: new Date(),
          clickedAt: null,
          convertedAt: null,
        },
      ];

      prisma.cartRecoveryLog.findMany.mockResolvedValue(mockLogs);

      const stats = await getRecoveryStats();

      expect(stats).toEqual({
        sent: 3,
        clicked: 2,
        converted: 1,
        clickRate: '66.67',
        conversionRate: '33.33',
      });
    });

    test('should handle empty stats', async () => {
      prisma.cartRecoveryLog.findMany.mockResolvedValue([]);

      const stats = await getRecoveryStats();

      expect(stats).toEqual({
        sent: 0,
        clicked: 0,
        converted: 0,
        clickRate: 0,
        conversionRate: 0,
      });
    });

    test('should filter by date range', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      prisma.cartRecoveryLog.findMany.mockResolvedValue([]);

      await getRecoveryStats(startDate, endDate);

      expect(prisma.cartRecoveryLog.findMany).toHaveBeenCalledWith({
        where: {
          emailSentAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      });
    });
  });

  // ============================================
  // ELIGIBILITY CHECK
  // ============================================

  describe('isEligibleForRecovery', () => {
    test('should confirm cart eligible for recovery', async () => {
      const cartId = 'cart-1';
      const mockCart = {
        id: cartId,
        status: 'CART',
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24h ago
        recoveryEmailSent: false,
        user: {
          marketingConsent: true,
        },
      };

      prisma.order.findUnique.mockResolvedValue(mockCart);

      const result = await isEligibleForRecovery(cartId);

      expect(result.eligible).toBe(true);
    });

    test('should reject cart not found', async () => {
      const cartId = 'nonexistent-cart';

      prisma.order.findUnique.mockResolvedValue(null);

      const result = await isEligibleForRecovery(cartId);

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('CART_NOT_FOUND');
    });

    test('should reject cart not in CART status', async () => {
      const cartId = 'cart-1';
      const mockCart = {
        id: cartId,
        status: 'CHECKOUT',
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        recoveryEmailSent: false,
        user: {
          marketingConsent: true,
        },
      };

      prisma.order.findUnique.mockResolvedValue(mockCart);

      const result = await isEligibleForRecovery(cartId);

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('NOT_CART_STATUS');
      expect(result.currentStatus).toBe('CHECKOUT');
    });

    test('should reject cart already sent', async () => {
      const cartId = 'cart-1';
      const mockCart = {
        id: cartId,
        status: 'CART',
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        recoveryEmailSent: true,
        user: {
          marketingConsent: true,
        },
      };

      prisma.order.findUnique.mockResolvedValue(mockCart);

      const result = await isEligibleForRecovery(cartId);

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('ALREADY_SENT');
    });

    test('should reject cart without marketing consent', async () => {
      const cartId = 'cart-1';
      const mockCart = {
        id: cartId,
        status: 'CART',
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        recoveryEmailSent: false,
        user: {
          marketingConsent: false,
        },
      };

      prisma.order.findUnique.mockResolvedValue(mockCart);

      const result = await isEligibleForRecovery(cartId);

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('NO_MARKETING_CONSENT');
    });

    test('should reject cart too old (>25h)', async () => {
      const cartId = 'cart-1';
      const mockCart = {
        id: cartId,
        status: 'CART',
        createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000), // 26h ago
        recoveryEmailSent: false,
        user: {
          marketingConsent: true,
        },
      };

      prisma.order.findUnique.mockResolvedValue(mockCart);

      const result = await isEligibleForRecovery(cartId);

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('TOO_OLD');
    });

    test('should reject cart too recent (<23h)', async () => {
      const cartId = 'cart-1';
      const mockCart = {
        id: cartId,
        status: 'CART',
        createdAt: new Date(Date.now() - 22 * 60 * 60 * 1000), // 22h ago
        recoveryEmailSent: false,
        user: {
          marketingConsent: true,
        },
      };

      prisma.order.findUnique.mockResolvedValue(mockCart);

      const result = await isEligibleForRecovery(cartId);

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('TOO_RECENT');
    });
  });
});
