const {
  startJob,
  stopJob,
  processAbandonedCarts,
  getStatus,
  DEFAULT_INTERVAL_MS,
} = require('../cartReminderJob');

const { scanAbandonedCarts } = require('../../services/cartRecoveryService');

// Mock CartRecoveryService
jest.mock('../../services/cartRecoveryService', () => ({
  scanAbandonedCarts: jest.fn(),
}));

describe('CartReminderJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Stop job if running from previous test
    try {
      stopJob();
    } catch (err) {
      // Ignore if not running
    }
  });

  afterEach(() => {
    stopJob();
    jest.useRealTimers();
  });

  // ============================================
  // PROCESS ABANDONED CARTS
  // ============================================

  describe('processAbandonedCarts', () => {
    test('should process abandoned carts successfully', async () => {
      const mockResult = {
        processed: 5,
        sent: 4,
        failed: 1,
        errors: [{ cartId: 'cart-1', error: 'EMAIL_FAILED' }],
      };

      scanAbandonedCarts.mockResolvedValue(mockResult);

      await processAbandonedCarts();

      expect(scanAbandonedCarts).toHaveBeenCalledTimes(1);
    });

    test('should handle scan errors gracefully', async () => {
      scanAbandonedCarts.mockRejectedValue(new Error('Database connection failed'));

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      await processAbandonedCarts();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to process abandoned carts'),
        expect.any(String)
      );

      consoleErrorSpy.mockRestore();
    });

    test('should prevent concurrent runs', async () => {
      // Use real timers for this test to avoid promise resolution issues
      jest.useRealTimers();

      scanAbandonedCarts.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));

      const promise1 = processAbandonedCarts();
      const promise2 = processAbandonedCarts(); // Should be skipped

      await promise1;
      await promise2;

      // Only one call should be made
      expect(scanAbandonedCarts).toHaveBeenCalledTimes(1);

      // Restore fake timers
      jest.useFakeTimers();
    });
  });

  // ============================================
  // JOB LIFECYCLE
  // ============================================

  describe('startJob', () => {
    test('should start job with default interval', () => {
      scanAbandonedCarts.mockResolvedValue({ processed: 0, sent: 0, failed: 0, errors: [] });

      startJob();

      const status = getStatus();
      expect(status.running).toBe(true);

      stopJob();
    });

    test('should start job with custom interval', () => {
      const customInterval = 60000; // 1 minute

      scanAbandonedCarts.mockResolvedValue({ processed: 0, sent: 0, failed: 0, errors: [] });

      startJob(customInterval);

      const status = getStatus();
      expect(status.running).toBe(true);

      stopJob();
    });

    test('should run immediately on start', async () => {
      // Use real timers for async tests
      jest.useRealTimers();

      scanAbandonedCarts.mockResolvedValue({ processed: 0, sent: 0, failed: 0, errors: [] });

      startJob();

      // Wait for immediate execution
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(scanAbandonedCarts).toHaveBeenCalledTimes(1);

      stopJob();

      // Restore fake timers
      jest.useFakeTimers();
    });

    test('should schedule periodic runs', async () => {
      // Use real timers for this async test
      jest.useRealTimers();

      scanAbandonedCarts.mockResolvedValue({ processed: 0, sent: 0, failed: 0, errors: [] });

      const intervalMs = 150; // 150ms for more reliable timing
      startJob(intervalMs);

      // Wait for immediate execution
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(scanAbandonedCarts).toHaveBeenCalled();
      const firstCallCount = scanAbandonedCarts.mock.calls.length;

      // Wait for next run
      await new Promise(resolve => setTimeout(resolve, intervalMs + 20));
      expect(scanAbandonedCarts).toHaveBeenCalledTimes(firstCallCount + 1);

      // Wait for another run
      await new Promise(resolve => setTimeout(resolve, intervalMs + 20));
      expect(scanAbandonedCarts).toHaveBeenCalledTimes(firstCallCount + 2);

      stopJob();

      // Restore fake timers
      jest.useFakeTimers();
    });

    test('should warn if job already running', () => {
      scanAbandonedCarts.mockResolvedValue({ processed: 0, sent: 0, failed: 0, errors: [] });

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      startJob();
      startJob(); // Try to start again

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Job already running')
      );

      consoleWarnSpy.mockRestore();
      stopJob();
    });

    test('should handle initial run failure', async () => {
      // Use real timers for async tests
      jest.useRealTimers();

      scanAbandonedCarts.mockRejectedValue(new Error('Initial run failed'));

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      startJob();

      // Wait for immediate execution
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to process abandoned carts'),
        expect.any(String)
      );

      consoleErrorSpy.mockRestore();
      stopJob();

      // Restore fake timers
      jest.useFakeTimers();
    });
  });

  describe('stopJob', () => {
    test('should stop running job', () => {
      scanAbandonedCarts.mockResolvedValue({ processed: 0, sent: 0, failed: 0, errors: [] });

      startJob();
      expect(getStatus().running).toBe(true);

      stopJob();
      expect(getStatus().running).toBe(false);
    });

    test('should warn if job not running', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      stopJob(); // Try to stop when not running

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Job not running')
      );

      consoleWarnSpy.mockRestore();
    });

    test('should clear interval on stop', async () => {
      // Use real timers for this async test
      jest.useRealTimers();

      scanAbandonedCarts.mockResolvedValue({ processed: 0, sent: 0, failed: 0, errors: [] });

      const intervalMs = 100;
      startJob(intervalMs);

      // Wait for immediate execution
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(scanAbandonedCarts).toHaveBeenCalledTimes(1);

      stopJob();

      // Wait - should not trigger new run
      await new Promise(resolve => setTimeout(resolve, intervalMs + 50));
      expect(scanAbandonedCarts).toHaveBeenCalledTimes(1); // Still 1, no new run

      // Restore fake timers
      jest.useFakeTimers();
    });
  });

  describe('getStatus', () => {
    test('should return status when job not running', () => {
      const status = getStatus();

      expect(status).toEqual({
        running: false,
        isProcessing: false,
      });
    });

    test('should return status when job running', () => {
      scanAbandonedCarts.mockResolvedValue({ processed: 0, sent: 0, failed: 0, errors: [] });

      startJob();

      const status = getStatus();
      expect(status.running).toBe(true);

      stopJob();
    });

    test('should return processing status during execution', async () => {
      // Use real timers for async tests
      jest.useRealTimers();

      scanAbandonedCarts.mockImplementation(() => new Promise(resolve => {
        setTimeout(() => resolve({ processed: 0, sent: 0, failed: 0, errors: [] }), 100);
      }));

      const promise = processAbandonedCarts();

      // Should be processing
      let status = getStatus();
      expect(status.isProcessing).toBe(true);

      await promise;

      // Should be done processing
      status = getStatus();
      expect(status.isProcessing).toBe(false);

      // Restore fake timers
      jest.useFakeTimers();
    });
  });

  // ============================================
  // ERROR HANDLING
  // ============================================

  describe('Error Handling', () => {
    test('should handle scheduled run failure', async () => {
      // Use real timers for async tests
      jest.useRealTimers();

      scanAbandonedCarts
        .mockResolvedValueOnce({ processed: 0, sent: 0, failed: 0, errors: [] }) // Initial run succeeds
        .mockRejectedValueOnce(new Error('Scheduled run failed')); // Next run fails

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const intervalMs = 100;
      startJob(intervalMs);

      // Wait for immediate execution
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(scanAbandonedCarts).toHaveBeenCalledTimes(1);

      // Wait for next run to trigger
      await new Promise(resolve => setTimeout(resolve, intervalMs + 50));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to process abandoned carts'),
        expect.any(String)
      );

      consoleErrorSpy.mockRestore();
      stopJob();

      // Restore fake timers
      jest.useFakeTimers();
    });

    test('should continue running after error', async () => {
      // Use real timers for async tests
      jest.useRealTimers();

      scanAbandonedCarts
        .mockResolvedValueOnce({ processed: 0, sent: 0, failed: 0, errors: [] }) // Initial run
        .mockRejectedValueOnce(new Error('Error')) // Scheduled run fails
        .mockResolvedValue({ processed: 0, sent: 0, failed: 0, errors: [] }); // Next runs succeed

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const intervalMs = 150;
      startJob(intervalMs);

      // Wait for immediate execution
      await new Promise(resolve => setTimeout(resolve, 50));

      // Wait for next run - error
      await new Promise(resolve => setTimeout(resolve, intervalMs + 20));

      // Wait for another run - should still run
      await new Promise(resolve => setTimeout(resolve, intervalMs + 20));

      // Verify at least 3 calls were made
      expect(scanAbandonedCarts.mock.calls.length).toBeGreaterThanOrEqual(3);

      consoleErrorSpy.mockRestore();
      stopJob();

      // Restore fake timers
      jest.useFakeTimers();
    });
  });

  // ============================================
  // CONSTANTS
  // ============================================

  describe('Constants', () => {
    test('should have correct default interval (5 minutes)', () => {
      expect(DEFAULT_INTERVAL_MS).toBe(5 * 60 * 1000);
    });
  });
});
