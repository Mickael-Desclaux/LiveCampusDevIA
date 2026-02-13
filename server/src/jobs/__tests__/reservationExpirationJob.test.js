const { runJob } = require('../reservationExpirationJob');
const { releaseStock } = require('../../services/stockReservationService');

// Mock dependencies
jest.mock('../../prisma', () => ({
  stockReservation: {
    findMany: jest.fn(),
  },
}));

jest.mock('../../services/stockReservationService', () => ({
  releaseStock: jest.fn(),
}));

const prisma = require('../../prisma');

describe('ReservationExpirationJob - F3 Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================
  // TEST 1: Process Expired Reservations
  // Criterion: Libération expiration garantie ≤2min
  // ============================================

  describe('Process Expired Reservations', () => {
    test('should release expired reservations', async () => {
      const now = new Date();
      const expiredTime = new Date(now.getTime() - 15 * 60 * 1000); // 15 min ago

      const mockExpiredReservations = [
        { orderId: 'order-1', expiresAt: expiredTime },
        { orderId: 'order-2', expiresAt: expiredTime },
      ];

      prisma.stockReservation.findMany.mockResolvedValue(mockExpiredReservations);
      releaseStock.mockResolvedValue({ success: true, releasedCount: 1 });

      await runJob();

      // Verify releaseStock was called for each expired order
      expect(releaseStock).toHaveBeenCalledTimes(2);
      expect(releaseStock).toHaveBeenCalledWith('order-1', 'EXPIRED');
      expect(releaseStock).toHaveBeenCalledWith('order-2', 'EXPIRED');
    });

    test('should not release if no expired reservations', async () => {
      prisma.stockReservation.findMany.mockResolvedValue([]);

      await runJob();

      expect(releaseStock).not.toHaveBeenCalled();
    });

    test('should continue processing if one release fails', async () => {
      const now = new Date();
      const expiredTime = new Date(now.getTime() - 15 * 60 * 1000);

      const mockExpiredReservations = [
        { orderId: 'order-1', expiresAt: expiredTime },
        { orderId: 'order-2', expiresAt: expiredTime },
        { orderId: 'order-3', expiresAt: expiredTime },
      ];

      prisma.stockReservation.findMany.mockResolvedValue(mockExpiredReservations);

      // First release fails, others succeed
      releaseStock
        .mockRejectedValueOnce(new Error('RELEASE_FAILED'))
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true });

      await runJob();

      // Should attempt all 3 releases despite first failure
      expect(releaseStock).toHaveBeenCalledTimes(3);
    });
  });

  // ============================================
  // TEST 2: Error Handling
  // Criterion: Resilience - Job continues despite errors
  // ============================================

  describe('Error Handling', () => {
    test('should handle database errors gracefully', async () => {
      prisma.stockReservation.findMany.mockRejectedValue(new Error('DB_ERROR'));

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      await runJob();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error processing expired reservations'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    test('should log error for individual release failures', async () => {
      const now = new Date();
      const expiredTime = new Date(now.getTime() - 15 * 60 * 1000);

      prisma.stockReservation.findMany.mockResolvedValue([
        { orderId: 'order-error', expiresAt: expiredTime },
      ]);

      releaseStock.mockRejectedValue(new Error('RELEASE_ERROR'));

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      await runJob();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to release stock for order'),
        expect.any(String)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  // ============================================
  // TEST 3: Job Lifecycle
  // Criterion: Job management
  // ============================================

  describe('Job Lifecycle', () => {
    const { startJob, stopJob } = require('../reservationExpirationJob');

    beforeEach(() => {
      jest.clearAllMocks();
      stopJob(); // Ensure clean state
    });

    afterEach(() => {
      stopJob(); // Clean up
    });

    test('should start job with default interval', () => {
      jest.useFakeTimers();

      prisma.stockReservation.findMany.mockResolvedValue([]);

      startJob();

      // Job should run immediately
      expect(prisma.stockReservation.findMany).toHaveBeenCalled();

      jest.clearAllMocks();

      // Advance time by 30 seconds (default interval)
      jest.advanceTimersByTime(30000);

      // Job should run again
      expect(prisma.stockReservation.findMany).toHaveBeenCalled();

      jest.useRealTimers();
    });

    test('should not start job twice if already running', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      prisma.stockReservation.findMany.mockResolvedValue([]);

      startJob();
      startJob(); // Try to start again

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Job already running')
      );

      consoleWarnSpy.mockRestore();
    });

    test('should stop job successfully', () => {
      jest.useFakeTimers();

      prisma.stockReservation.findMany.mockResolvedValue([]);

      startJob();
      stopJob();

      jest.clearAllMocks();

      // Advance time
      jest.advanceTimersByTime(60000);

      // Job should NOT run after stopping
      expect(prisma.stockReservation.findMany).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    test('should start job with custom interval', () => {
      jest.useFakeTimers();

      prisma.stockReservation.findMany.mockResolvedValue([]);

      const customInterval = 60000; // 60 seconds
      startJob(customInterval);

      jest.clearAllMocks();

      // Advance time by custom interval
      jest.advanceTimersByTime(customInterval);

      // Job should run
      expect(prisma.stockReservation.findMany).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  // ============================================
  // TEST 4: Distinct Order Processing
  // Criterion: No duplicate processing
  // ============================================

  describe('Distinct Order Processing', () => {
    test('should process each order only once (distinct orderId)', async () => {
      const now = new Date();
      const expiredTime = new Date(now.getTime() - 15 * 60 * 1000);

      // Mock returns distinct orders only (Prisma distinct query)
      const mockExpiredReservations = [
        { orderId: 'order-1', expiresAt: expiredTime },
        { orderId: 'order-2', expiresAt: expiredTime },
      ];

      prisma.stockReservation.findMany.mockResolvedValue(mockExpiredReservations);
      releaseStock.mockResolvedValue({ success: true });

      await runJob();

      // Should call releaseStock exactly once per order
      expect(releaseStock).toHaveBeenCalledTimes(2);
      expect(releaseStock).toHaveBeenCalledWith('order-1', 'EXPIRED');
      expect(releaseStock).toHaveBeenCalledWith('order-2', 'EXPIRED');
    });
  });
});
