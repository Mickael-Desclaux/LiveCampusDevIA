const { runJob } = require('../stateTimeoutJob');
const { transitionOrderState } = require('../../services/orderStateMachine');

// Mock dependencies
jest.mock('../../prisma', () => ({
  order: {
    findMany: jest.fn(),
  },
}));

jest.mock('../../services/orderStateMachine', () => ({
  transitionOrderState: jest.fn(),
  STATE_TIMEOUTS: {
    CHECKOUT: 15 * 60 * 1000, // 15 minutes
    PREPARING: 48 * 60 * 60 * 1000, // 48 hours
  },
}));

const prisma = require('../../prisma');

describe('StateTimeoutJob - F4 Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================
  // TEST 1: Expired CHECKOUT Orders
  // Criterion: Timeout states ≤2min delay
  // ============================================

  describe('Expired CHECKOUT Orders', () => {
    test('should transition expired CHECKOUT orders to CANCELLED', async () => {
      const now = new Date();
      const expiredCheckoutAt = new Date(now.getTime() - 20 * 60 * 1000); // 20 minutes ago

      const mockExpiredOrders = [
        { id: 'order-1', checkoutAt: expiredCheckoutAt },
        { id: 'order-2', checkoutAt: expiredCheckoutAt },
      ];

      prisma.order.findMany.mockResolvedValueOnce(mockExpiredOrders); // For CHECKOUT
      prisma.order.findMany.mockResolvedValueOnce([]); // For PREPARING

      transitionOrderState.mockResolvedValue({ success: true });

      await runJob();

      // Verify that transitionOrderState was called for each expired order
      expect(transitionOrderState).toHaveBeenCalledTimes(2);
      expect(transitionOrderState).toHaveBeenCalledWith(
        'order-1',
        'CANCELLED',
        'CHECKOUT_TIMEOUT',
        'SYSTEM'
      );
      expect(transitionOrderState).toHaveBeenCalledWith(
        'order-2',
        'CANCELLED',
        'CHECKOUT_TIMEOUT',
        'SYSTEM'
      );
    });

    test('should not transition CHECKOUT orders within timeout window', async () => {
      const now = new Date();
      const recentCheckoutAt = new Date(now.getTime() - 5 * 60 * 1000); // 5 minutes ago

      prisma.order.findMany.mockResolvedValueOnce([]); // No expired CHECKOUT orders
      prisma.order.findMany.mockResolvedValueOnce([]); // No expired PREPARING orders

      await runJob();

      expect(transitionOrderState).not.toHaveBeenCalled();
    });

    test('should continue processing other orders if one fails', async () => {
      const now = new Date();
      const expiredCheckoutAt = new Date(now.getTime() - 20 * 60 * 1000);

      const mockExpiredOrders = [
        { id: 'order-1', checkoutAt: expiredCheckoutAt },
        { id: 'order-2', checkoutAt: expiredCheckoutAt },
        { id: 'order-3', checkoutAt: expiredCheckoutAt },
      ];

      prisma.order.findMany.mockResolvedValueOnce(mockExpiredOrders);
      prisma.order.findMany.mockResolvedValueOnce([]);

      // Mock first transition to fail
      transitionOrderState
        .mockRejectedValueOnce(new Error('TRANSITION_FAILED'))
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true });

      await runJob();

      // Should attempt all 3 transitions despite first failure
      expect(transitionOrderState).toHaveBeenCalledTimes(3);
    });
  });

  // ============================================
  // TEST 2: Expired PREPARING Orders (Alert Only)
  // Criterion: Alert ops for manual intervention
  // ============================================

  describe('Expired PREPARING Orders', () => {
    test('should alert on expired PREPARING orders without auto-transition', async () => {
      const now = new Date();
      const expiredUpdatedAt = new Date(now.getTime() - 50 * 60 * 60 * 1000); // 50 hours ago

      const mockExpiredOrders = [
        { id: 'order-10', userId: 'user-1', updatedAt: expiredUpdatedAt },
        { id: 'order-11', userId: 'user-2', updatedAt: expiredUpdatedAt },
      ];

      prisma.order.findMany.mockResolvedValueOnce([]); // No expired CHECKOUT
      prisma.order.findMany.mockResolvedValueOnce(mockExpiredOrders); // Expired PREPARING

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      await runJob();

      // Should log warnings but NOT call transitionOrderState
      expect(transitionOrderState).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('2 orders in PREPARING state exceed 48h timeout')
      );

      consoleWarnSpy.mockRestore();
    });

    test('should not alert if no PREPARING orders are expired', async () => {
      prisma.order.findMany.mockResolvedValueOnce([]); // No expired CHECKOUT
      prisma.order.findMany.mockResolvedValueOnce([]); // No expired PREPARING

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      await runJob();

      expect(consoleWarnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('orders in PREPARING state exceed 48h timeout')
      );

      consoleWarnSpy.mockRestore();
    });
  });

  // ============================================
  // TEST 3: Error Handling
  // Criterion: Resilience - job continues despite errors
  // ============================================

  describe('Error Handling', () => {
    test('should handle database errors gracefully', async () => {
      prisma.order.findMany.mockRejectedValueOnce(new Error('DB_CONNECTION_ERROR'));

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      await runJob();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error processing expired checkouts'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    test('should handle transition errors without crashing', async () => {
      const now = new Date();
      const expiredCheckoutAt = new Date(now.getTime() - 20 * 60 * 1000);

      const mockExpiredOrders = [{ id: 'order-1', checkoutAt: expiredCheckoutAt }];

      prisma.order.findMany.mockResolvedValueOnce(mockExpiredOrders);
      prisma.order.findMany.mockResolvedValueOnce([]);

      transitionOrderState.mockRejectedValue(new Error('TRANSITION_ERROR'));

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      await runJob();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to cancel order'),
        expect.any(String)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  // ============================================
  // TEST 4: Job Execution Flow
  // Criterion: Job runs both CHECKOUT and PREPARING checks
  // ============================================

  describe('Job Execution Flow', () => {
    test('should execute both CHECKOUT and PREPARING checks in single run', async () => {
      const now = new Date();
      const expiredCheckoutAt = new Date(now.getTime() - 20 * 60 * 1000);
      const expiredUpdatedAt = new Date(now.getTime() - 50 * 60 * 60 * 1000);

      prisma.order.findMany.mockResolvedValueOnce([
        { id: 'order-1', checkoutAt: expiredCheckoutAt },
      ]);
      prisma.order.findMany.mockResolvedValueOnce([
        { id: 'order-2', userId: 'user-1', updatedAt: expiredUpdatedAt },
      ]);

      transitionOrderState.mockResolvedValue({ success: true });

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      await runJob();

      // Verify both queries were made
      expect(prisma.order.findMany).toHaveBeenCalledTimes(2);

      // Verify CHECKOUT transition was attempted
      expect(transitionOrderState).toHaveBeenCalledWith(
        'order-1',
        'CANCELLED',
        'CHECKOUT_TIMEOUT',
        'SYSTEM'
      );

      // Verify PREPARING alert was logged
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('1 orders in PREPARING state exceed 48h timeout')
      );

      consoleWarnSpy.mockRestore();
    });
  });

  // ============================================
  // TEST 5: Job Start/Stop Lifecycle
  // Criterion: Job management
  // ============================================

  describe('Job Lifecycle', () => {
    const { startJob, stopJob } = require('../stateTimeoutJob');

    beforeEach(() => {
      jest.clearAllMocks();
      stopJob(); // Ensure clean state
    });

    afterEach(() => {
      stopJob(); // Clean up after tests
    });

    test('should start job with default interval', () => {
      jest.useFakeTimers();

      prisma.order.findMany.mockResolvedValue([]);

      startJob();

      // Job should run immediately
      expect(prisma.order.findMany).toHaveBeenCalled();

      jest.clearAllMocks();

      // Advance time by 60 seconds
      jest.advanceTimersByTime(60000);

      // Job should run again
      expect(prisma.order.findMany).toHaveBeenCalled();

      jest.useRealTimers();
    });

    test('should not start job twice if already running', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      prisma.order.findMany.mockResolvedValue([]);

      startJob();
      startJob(); // Try to start again

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Job already running')
      );

      consoleWarnSpy.mockRestore();
    });

    test('should stop job successfully', () => {
      jest.useFakeTimers();

      prisma.order.findMany.mockResolvedValue([]);

      startJob();
      stopJob();

      jest.clearAllMocks();

      // Advance time
      jest.advanceTimersByTime(120000);

      // Job should NOT run after stopping
      expect(prisma.order.findMany).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    test('should start job with custom interval', () => {
      jest.useFakeTimers();

      prisma.order.findMany.mockResolvedValue([]);

      const customInterval = 30000; // 30 seconds
      startJob(customInterval);

      jest.clearAllMocks();

      // Advance time by custom interval
      jest.advanceTimersByTime(customInterval);

      // Job should run
      expect(prisma.order.findMany).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });
});
