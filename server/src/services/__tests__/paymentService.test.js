const {
  processPayment,
  getPaymentAttempts,
  isPaymentExpired,
  validateOrderForPayment,
  isRetryAllowed,
  callPaymentGateway,
  handlePaymentSuccess,
  handlePaymentFailure,
  ERROR_CLASSIFICATION,
  RETRY_WINDOW_MS,
  CHECKOUT_EXPIRATION_MS,
} = require('../paymentService');
const { releaseStock } = require('../stockReservationService');
const { transitionState } = require('../orderStateMachine');

// Mock dependencies
jest.mock('../../prisma', () => ({
  order: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  paymentAttempt: {
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(callback => callback({
    paymentAttempt: {
      update: jest.fn(),
    },
    order: {
      update: jest.fn(),
    },
  })),
}));

jest.mock('../stockReservationService', () => ({
  releaseStock: jest.fn(),
}));

jest.mock('../orderStateMachine', () => ({
  transitionState: jest.fn(),
}));

const prisma = require('../../prisma');

describe('PaymentService - F5 Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================
  // TEST 1: Order Validation
  // Criterion: Validate order is ready for payment
  // ============================================

  describe('Order Validation', () => {
    test('should validate order successfully', () => {
      const validOrder = {
        id: 'order-1',
        status: 'CHECKOUT',
        checkoutAt: new Date(Date.now() - 5 * 60 * 1000), // 5min ago
        totalSnapshot: 100.00,
      };

      const result = validateOrderForPayment(validOrder);

      expect(result.valid).toBe(true);
    });

    test('should reject null order', () => {
      const result = validateOrderForPayment(null);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('ORDER_NOT_FOUND');
    });

    test('should reject order with invalid status', () => {
      const order = {
        id: 'order-1',
        status: 'CART',
        checkoutAt: new Date(),
        totalSnapshot: 100.00,
      };

      const result = validateOrderForPayment(order);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('INVALID_STATUS');
      expect(result.current).toBe('CART');
    });

    test('should reject order without checkoutAt', () => {
      const order = {
        id: 'order-1',
        status: 'CHECKOUT',
        checkoutAt: null,
        totalSnapshot: 100.00,
      };

      const result = validateOrderForPayment(order);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('MISSING_CHECKOUT_TIMESTAMP');
    });

    test('should reject expired checkout (>10min)', () => {
      const order = {
        id: 'order-1',
        status: 'CHECKOUT',
        checkoutAt: new Date(Date.now() - 11 * 60 * 1000), // 11min ago
        totalSnapshot: 100.00,
      };

      const result = validateOrderForPayment(order);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('CHECKOUT_EXPIRED');
      expect(result.elapsedMs).toBeGreaterThan(CHECKOUT_EXPIRATION_MS);
    });

    test('should reject order without totalSnapshot', () => {
      const order = {
        id: 'order-1',
        status: 'CHECKOUT',
        checkoutAt: new Date(),
        totalSnapshot: null,
      };

      const result = validateOrderForPayment(order);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('MISSING_TOTAL');
    });
  });

  // ============================================
  // TEST 2: Retry Window Logic
  // Criterion: Allow retry within 5min, reject after
  // ============================================

  describe('Retry Window Logic', () => {
    test('should allow retry when no previous attempt', () => {
      const result = isRetryAllowed(null);

      expect(result).toBe(true);
    });

    test('should reject retry when payment already succeeded', () => {
      const lastAttempt = {
        status: 'SUCCESS',
        updatedAt: new Date(Date.now() - 1 * 60 * 1000), // 1min ago
      };

      const result = isRetryAllowed(lastAttempt);

      expect(result).toBe(false);
    });

    test('should reject retry when payment is pending', () => {
      const lastAttempt = {
        status: 'PENDING',
        updatedAt: new Date(Date.now() - 30 * 1000), // 30s ago
      };

      const result = isRetryAllowed(lastAttempt);

      expect(result).toBe(false);
    });

    test('should allow retry within 5min window after failure', () => {
      const lastAttempt = {
        status: 'FAILED',
        updatedAt: new Date(Date.now() - 3 * 60 * 1000), // 3min ago
      };

      const result = isRetryAllowed(lastAttempt);

      expect(result).toBe(true);
    });

    test('should reject retry after 5min window', () => {
      const lastAttempt = {
        status: 'FAILED',
        updatedAt: new Date(Date.now() - 6 * 60 * 1000), // 6min ago
      };

      const result = isRetryAllowed(lastAttempt);

      expect(result).toBe(false);
    });
  });

  // ============================================
  // TEST 3: Error Classification
  // Criterion: Classify errors as DEFINITIVE or TEMPORARY
  // ============================================

  describe('Error Classification', () => {
    test('should classify INSUFFICIENT_FUNDS as DEFINITIVE', () => {
      expect(ERROR_CLASSIFICATION.INSUFFICIENT_FUNDS).toBe('DEFINITIVE');
    });

    test('should classify CARD_DECLINED as DEFINITIVE', () => {
      expect(ERROR_CLASSIFICATION.CARD_DECLINED).toBe('DEFINITIVE');
    });

    test('should classify CARD_EXPIRED as DEFINITIVE', () => {
      expect(ERROR_CLASSIFICATION.CARD_EXPIRED).toBe('DEFINITIVE');
    });

    test('should classify FRAUD_SUSPECTED as DEFINITIVE', () => {
      expect(ERROR_CLASSIFICATION.FRAUD_SUSPECTED).toBe('DEFINITIVE');
    });

    test('should classify GATEWAY_TIMEOUT as TEMPORARY', () => {
      expect(ERROR_CLASSIFICATION.GATEWAY_TIMEOUT).toBe('TEMPORARY');
    });

    test('should classify NETWORK_ERROR as TEMPORARY', () => {
      expect(ERROR_CLASSIFICATION.NETWORK_ERROR).toBe('TEMPORARY');
    });

    test('should classify THREE_DS_TIMEOUT as TEMPORARY', () => {
      expect(ERROR_CLASSIFICATION.THREE_DS_TIMEOUT).toBe('TEMPORARY');
    });

    test('should classify TECHNICAL_ERROR as TEMPORARY', () => {
      expect(ERROR_CLASSIFICATION.TECHNICAL_ERROR).toBe('TEMPORARY');
    });
  });

  // ============================================
  // TEST 4: Payment Success Flow
  // Criterion: Update attempt, set paymentId, transition to PAID
  // ============================================

  describe('Payment Success Flow', () => {
    test('should handle successful payment correctly', async () => {
      const orderId = 'order-1';
      const attemptId = 'attempt-1';
      const transactionId = 'txn_123456';

      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          paymentAttempt: {
            update: jest.fn().mockResolvedValue({ id: attemptId, status: 'SUCCESS' }),
          },
          order: {
            update: jest.fn().mockResolvedValue({ id: orderId, paymentId: transactionId }),
          },
        };

        return await callback(tx);
      });

      transitionState.mockResolvedValue({ success: true });

      const result = await handlePaymentSuccess(orderId, attemptId, transactionId);

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe(transactionId);
      expect(transitionState).toHaveBeenCalledWith(orderId, 'PAID', 'PAYMENT_SUCCESS');
    });
  });

  // ============================================
  // TEST 5: Payment Failure - DEFINITIVE
  // Criterion: Release stock + transition to CANCELLED
  // ============================================

  describe('Payment Failure - DEFINITIVE', () => {
    test('should release stock and cancel order on DEFINITIVE error', async () => {
      const orderId = 'order-1';
      const attemptId = 'attempt-1';
      const errorCode = 'CARD_DECLINED';
      const errorType = 'CARD_DECLINED';

      prisma.paymentAttempt.update.mockResolvedValue({ id: attemptId, status: 'FAILED' });
      releaseStock.mockResolvedValue({ success: true, releasedCount: 2 });
      transitionState.mockResolvedValue({ success: true });

      const result = await handlePaymentFailure(orderId, attemptId, errorCode, errorType);

      expect(result.success).toBe(false);
      expect(result.errorClassification).toBe('DEFINITIVE');
      expect(releaseStock).toHaveBeenCalledWith(orderId, 'PAYMENT_FAILED_DEFINITIVE');
      expect(transitionState).toHaveBeenCalledWith(orderId, 'CANCELLED', 'PAYMENT_FAILED_DEFINITIVE');
    });

    test('should continue to cancel even if stock release fails', async () => {
      const orderId = 'order-1';
      const attemptId = 'attempt-1';
      const errorCode = 'INSUFFICIENT_FUNDS';
      const errorType = 'INSUFFICIENT_FUNDS';

      prisma.paymentAttempt.update.mockResolvedValue({ id: attemptId, status: 'FAILED' });
      releaseStock.mockRejectedValue(new Error('RELEASE_FAILED'));
      transitionState.mockResolvedValue({ success: true });

      const result = await handlePaymentFailure(orderId, attemptId, errorCode, errorType);

      expect(result.success).toBe(false);
      expect(result.errorClassification).toBe('DEFINITIVE');
      expect(releaseStock).toHaveBeenCalled();
      expect(transitionState).toHaveBeenCalledWith(orderId, 'CANCELLED', 'PAYMENT_FAILED_DEFINITIVE');
    });
  });

  // ============================================
  // TEST 6: Payment Failure - TEMPORARY
  // Criterion: Keep reservation, allow retry
  // ============================================

  describe('Payment Failure - TEMPORARY', () => {
    test('should keep reservation on TEMPORARY error', async () => {
      const orderId = 'order-1';
      const attemptId = 'attempt-1';
      const errorCode = 'GATEWAY_TIMEOUT';
      const errorType = 'GATEWAY_TIMEOUT';

      prisma.paymentAttempt.update.mockResolvedValue({ id: attemptId, status: 'FAILED' });

      const result = await handlePaymentFailure(orderId, attemptId, errorCode, errorType);

      expect(result.success).toBe(false);
      expect(result.errorClassification).toBe('TEMPORARY');
      expect(releaseStock).not.toHaveBeenCalled();
      expect(transitionState).not.toHaveBeenCalled();
    });

    test('should classify unknown error as TEMPORARY by default', async () => {
      const orderId = 'order-1';
      const attemptId = 'attempt-1';
      const errorCode = 'UNKNOWN_ERROR';
      const errorType = 'UNKNOWN_ERROR';

      prisma.paymentAttempt.update.mockResolvedValue({ id: attemptId, status: 'FAILED' });

      const result = await handlePaymentFailure(orderId, attemptId, errorCode, errorType);

      expect(result.success).toBe(false);
      expect(result.errorClassification).toBe('TEMPORARY');
    });
  });

  // ============================================
  // TEST 7: Process Payment - Integration
  // Criterion: End-to-end payment flow
  // ============================================

  describe('Process Payment - Integration', () => {
    test('should process payment successfully', async () => {
      const orderId = 'order-1';
      const mockOrder = {
        id: orderId,
        status: 'CHECKOUT',
        checkoutAt: new Date(Date.now() - 2 * 60 * 1000), // 2min ago
        totalSnapshot: 100.00,
        paymentAttempts: [],
      };

      const mockAttempt = {
        id: 'attempt-1',
        orderId,
        status: 'PENDING',
      };

      prisma.order.findUnique.mockResolvedValue(mockOrder);
      prisma.paymentAttempt.create.mockResolvedValue(mockAttempt);

      // Mock gateway function using Dependency Injection
      const mockGateway = jest.fn().mockResolvedValue({
        success: true,
        transactionId: 'txn_123456',
      });

      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          paymentAttempt: {
            update: jest.fn().mockResolvedValue({ id: mockAttempt.id, status: 'SUCCESS' }),
          },
          order: {
            update: jest.fn().mockResolvedValue({ id: orderId, paymentId: 'txn_123456' }),
          },
        };

        return await callback(tx);
      });

      transitionState.mockResolvedValue({ success: true });

      // Inject mock gateway function as 3rd parameter
      const result = await processPayment(orderId, { method: 'CREDIT_CARD' }, mockGateway);

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('txn_123456');
      expect(transitionState).toHaveBeenCalledWith(orderId, 'PAID', 'PAYMENT_SUCCESS');
      expect(mockGateway).toHaveBeenCalledWith({
        orderId,
        amount: 100.00,
        method: 'CREDIT_CARD',
      });
    });

    test('should handle payment already succeeded (idempotent)', async () => {
      const orderId = 'order-1';
      const mockOrder = {
        id: orderId,
        status: 'CHECKOUT',
        checkoutAt: new Date(Date.now() - 2 * 60 * 1000),
        totalSnapshot: 100.00,
        paymentId: 'txn_existing',
        paymentAttempts: [{
          id: 'attempt-1',
          status: 'SUCCESS',
          createdAt: new Date(),
        }],
      };

      prisma.order.findUnique.mockResolvedValue(mockOrder);

      const result = await processPayment(orderId);

      expect(result.success).toBe(true);
      expect(result.idempotent).toBe(true);
      expect(result.transactionId).toBe('txn_existing');
      expect(prisma.paymentAttempt.create).not.toHaveBeenCalled();
    });

    test('should throw error if order not found', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(processPayment('order-invalid')).rejects.toThrow('ORDER_NOT_FOUND');
    });

    test('should throw error if checkout expired', async () => {
      const mockOrder = {
        id: 'order-1',
        status: 'CHECKOUT',
        checkoutAt: new Date(Date.now() - 15 * 60 * 1000), // 15min ago
        totalSnapshot: 100.00,
        paymentAttempts: [],
      };

      prisma.order.findUnique.mockResolvedValue(mockOrder);

      await expect(processPayment('order-1')).rejects.toThrow('CHECKOUT_EXPIRED');
    });

    test('should throw error if retry not allowed', async () => {
      const mockOrder = {
        id: 'order-1',
        status: 'CHECKOUT',
        checkoutAt: new Date(Date.now() - 2 * 60 * 1000),
        totalSnapshot: 100.00,
        paymentAttempts: [{
          id: 'attempt-1',
          status: 'FAILED',
          updatedAt: new Date(Date.now() - 6 * 60 * 1000), // 6min ago
        }],
      };

      prisma.order.findUnique.mockResolvedValue(mockOrder);

      await expect(processPayment('order-1')).rejects.toThrow('RETRY_NOT_ALLOWED');
    });
  });

  // ============================================
  // TEST 8: Get Payment Attempts
  // Criterion: Retrieve payment history
  // ============================================

  describe('Get Payment Attempts', () => {
    test('should get all payment attempts for an order', async () => {
      const orderId = 'order-1';
      const mockAttempts = [
        { id: 'attempt-2', orderId, status: 'FAILED', createdAt: new Date() },
        { id: 'attempt-1', orderId, status: 'FAILED', createdAt: new Date(Date.now() - 5 * 60 * 1000) },
      ];

      prisma.paymentAttempt.findMany.mockResolvedValue(mockAttempts);

      const result = await getPaymentAttempts(orderId);

      expect(result).toEqual(mockAttempts);
      expect(prisma.paymentAttempt.findMany).toHaveBeenCalledWith({
        where: { orderId },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  // ============================================
  // TEST 9: Check Payment Expiration
  // Criterion: Detect expired checkouts
  // ============================================

  describe('Check Payment Expiration', () => {
    test('should return true if checkout expired', async () => {
      const mockOrder = {
        status: 'CHECKOUT',
        checkoutAt: new Date(Date.now() - 12 * 60 * 1000), // 12min ago
      };

      prisma.order.findUnique.mockResolvedValue(mockOrder);

      const result = await isPaymentExpired('order-1');

      expect(result).toBe(true);
    });

    test('should return false if checkout not expired', async () => {
      const mockOrder = {
        status: 'CHECKOUT',
        checkoutAt: new Date(Date.now() - 5 * 60 * 1000), // 5min ago
      };

      prisma.order.findUnique.mockResolvedValue(mockOrder);

      const result = await isPaymentExpired('order-1');

      expect(result).toBe(false);
    });

    test('should return false if order not found', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      const result = await isPaymentExpired('order-invalid');

      expect(result).toBe(false);
    });

    test('should return false if order not in CHECKOUT status', async () => {
      const mockOrder = {
        status: 'PAID',
        checkoutAt: new Date(Date.now() - 12 * 60 * 1000),
      };

      prisma.order.findUnique.mockResolvedValue(mockOrder);

      const result = await isPaymentExpired('order-1');

      expect(result).toBe(false);
    });
  });

  // ============================================
  // TEST 10: Gateway Exception Handling
  // Criterion: Handle technical errors gracefully
  // ============================================

  describe('Gateway Exception Handling', () => {
    test('should handle gateway exception as TECHNICAL_ERROR', async () => {
      const orderId = 'order-1';
      const mockOrder = {
        id: orderId,
        status: 'CHECKOUT',
        checkoutAt: new Date(Date.now() - 2 * 60 * 1000),
        totalSnapshot: 100.00,
        paymentAttempts: [],
      };

      const mockAttempt = {
        id: 'attempt-1',
        orderId,
        status: 'PENDING',
      };

      prisma.order.findUnique.mockResolvedValue(mockOrder);
      prisma.paymentAttempt.create.mockResolvedValue(mockAttempt);

      // Mock gateway throwing exception using Dependency Injection
      const mockGateway = jest.fn().mockRejectedValue(new Error('Network timeout'));

      prisma.paymentAttempt.update.mockResolvedValue({ id: mockAttempt.id, status: 'FAILED' });

      // Inject mock gateway that throws exception
      const result = await processPayment(orderId, {}, mockGateway);

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('TECHNICAL_ERROR');
      expect(result.errorClassification).toBe('TEMPORARY');
      expect(mockGateway).toHaveBeenCalled();
    });
  });
});
