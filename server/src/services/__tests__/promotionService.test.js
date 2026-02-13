const {
  validateAndApplyPromotions,
  incrementPromotionUsage,
  getUserPromotionUsage,
  validatePromotionCompatibility,
  sortPromotionsByOrder,
  calculateSingleDiscount,
  PROMOTION_ORDER,
} = require('../promotionService');

// Mock Prisma client
jest.mock('../../prisma', () => ({
  promotion: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  promotionUsage: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
  },
}));

const prisma = require('../../prisma');

describe('PromotionService - F2 Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================
  // TEST 1: Promotion Compatibility Matrix
  // Criterion: Compatibility rules 100%
  // ============================================

  describe('Promotion Compatibility Matrix', () => {
    test('should allow multiple STACKABLE promotions', () => {
      const promotions = [
        { tag: 'STACKABLE', code: 'STACK1' },
        { tag: 'STACKABLE', code: 'STACK2' },
      ];

      expect(() => validatePromotionCompatibility(promotions)).not.toThrow();
    });

    test('should allow AUTO + STACKABLE combination', () => {
      const promotions = [
        { tag: 'AUTO', code: 'AUTO1' },
        { tag: 'STACKABLE', code: 'STACK1' },
      ];

      expect(() => validatePromotionCompatibility(promotions)).not.toThrow();
    });

    test('should allow multiple AUTO promotions', () => {
      const promotions = [
        { tag: 'AUTO', code: 'AUTO1' },
        { tag: 'AUTO', code: 'AUTO2' },
        { tag: 'AUTO', code: 'AUTO3' },
      ];

      expect(() => validatePromotionCompatibility(promotions)).not.toThrow();
    });

    test('should allow single EXCLUSIVE promotion', () => {
      const promotions = [
        { tag: 'EXCLUSIVE', code: 'EXCL1' },
      ];

      expect(() => validatePromotionCompatibility(promotions)).not.toThrow();
    });

    test('should reject multiple EXCLUSIVE promotions', () => {
      const promotions = [
        { tag: 'EXCLUSIVE', code: 'EXCL1' },
        { tag: 'EXCLUSIVE', code: 'EXCL2' },
      ];

      expect(() => validatePromotionCompatibility(promotions)).toThrow(
        'INCOMPATIBLE_PROMOTIONS: Only one EXCLUSIVE promotion allowed'
      );
    });

    test('should reject EXCLUSIVE + STACKABLE combination', () => {
      const promotions = [
        { tag: 'EXCLUSIVE', code: 'EXCL1' },
        { tag: 'STACKABLE', code: 'STACK1' },
      ];

      expect(() => validatePromotionCompatibility(promotions)).toThrow(
        'INCOMPATIBLE_PROMOTIONS: EXCLUSIVE promotions cannot be combined with others'
      );
    });

    test('should reject EXCLUSIVE + AUTO combination', () => {
      const promotions = [
        { tag: 'EXCLUSIVE', code: 'EXCL1' },
        { tag: 'AUTO', code: 'AUTO1' },
      ];

      expect(() => validatePromotionCompatibility(promotions)).toThrow(
        'INCOMPATIBLE_PROMOTIONS: EXCLUSIVE promotions cannot be combined with others'
      );
    });
  });

  // ============================================
  // TEST 2: Deterministic Ordering
  // Criterion: Order application deterministic 100%
  // ============================================

  describe('Deterministic Promotion Ordering', () => {
    test('should sort promotions in order AUTO → STACKABLE → EXCLUSIVE', () => {
      const promotions = [
        { tag: 'EXCLUSIVE', code: 'EXCL1' },
        { tag: 'AUTO', code: 'AUTO1' },
        { tag: 'STACKABLE', code: 'STACK1' },
      ];

      const sorted = sortPromotionsByOrder(promotions);

      expect(sorted[0].tag).toBe('AUTO');
      expect(sorted[1].tag).toBe('STACKABLE');
      expect(sorted[2].tag).toBe('EXCLUSIVE');
    });

    test('should maintain order stability for same tags', () => {
      const promotions = [
        { tag: 'AUTO', code: 'AUTO2' },
        { tag: 'AUTO', code: 'AUTO1' },
        { tag: 'AUTO', code: 'AUTO3' },
      ];

      const sorted = sortPromotionsByOrder(promotions);

      // All should be AUTO tag
      sorted.forEach(p => expect(p.tag).toBe('AUTO'));
    });

    test('should verify PROMOTION_ORDER constants', () => {
      expect(PROMOTION_ORDER.AUTO).toBe(1);
      expect(PROMOTION_ORDER.STACKABLE).toBe(2);
      expect(PROMOTION_ORDER.EXCLUSIVE).toBe(3);
    });
  });

  // ============================================
  // TEST 3: Discount Calculation (Exact)
  // Criterion: Exactitude calcul 100%
  // ============================================

  describe('Discount Calculation', () => {
    test('should calculate PERCENTAGE discount correctly', () => {
      const promotion = { type: 'PERCENTAGE', value: 10 }; // 10%
      const discount = calculateSingleDiscount(100, promotion);

      expect(discount).toBe(10);
    });

    test('should calculate FIXED_AMOUNT discount correctly', () => {
      const promotion = { type: 'FIXED_AMOUNT', value: 15 };
      const discount = calculateSingleDiscount(100, promotion);

      expect(discount).toBe(15);
    });

    test('should return 0 for FREE_SHIPPING discount', () => {
      const promotion = { type: 'FREE_SHIPPING', value: 0 };
      const discount = calculateSingleDiscount(100, promotion);

      expect(discount).toBe(0);
    });

    test('should throw error for unknown promotion type', () => {
      const promotion = { type: 'UNKNOWN', value: 10 };

      expect(() => calculateSingleDiscount(100, promotion)).toThrow(
        'UNKNOWN_PROMOTION_TYPE'
      );
    });
  });

  // ============================================
  // TEST 4: Final Amount Protection (>= 0)
  // Criterion: Montant final ≥0€ toujours
  // ============================================

  describe('Final Amount Protection', () => {
    test('should protect final amount from going below 0', async () => {
      const subtotal = 50;

      // Mock AUTO promotion with 100% discount
      prisma.promotion.findMany.mockResolvedValue([
        {
          id: 'promo-1',
          code: 'AUTO100',
          type: 'PERCENTAGE',
          tag: 'AUTO',
          value: 100, // 100% off
          active: true,
          expiresAt: null,
          usageLimitPerUser: 1,
        },
      ]);

      prisma.promotionUsage.findUnique.mockResolvedValue(null);

      const result = await validateAndApplyPromotions('user-1', subtotal, []);

      expect(result.finalAmount).toBe(0);
      expect(result.finalAmount).toBeGreaterThanOrEqual(0);
    });

    test('should protect when total discounts exceed subtotal', async () => {
      const subtotal = 100;

      // Mock promotions that would exceed subtotal
      prisma.promotion.findMany.mockResolvedValue([
        {
          id: 'promo-1',
          code: 'AUTO50',
          type: 'PERCENTAGE',
          tag: 'AUTO',
          value: 50,
          active: true,
          expiresAt: null,
          usageLimitPerUser: 1,
        },
      ]);

      prisma.promotion.findUnique.mockResolvedValue({
        id: 'promo-2',
        code: 'STACK80',
        type: 'FIXED_AMOUNT',
        tag: 'STACKABLE',
        value: 80,
        active: true,
        expiresAt: null,
        usageLimitPerUser: 1,
      });

      prisma.promotionUsage.findUnique.mockResolvedValue(null);

      const result = await validateAndApplyPromotions('user-1', subtotal, ['STACK80']);

      // 100 - 50 (50%) = 50, then 50 - 80 = -30 → protected to 0
      expect(result.finalAmount).toBe(0);
    });
  });

  // ============================================
  // TEST 5: Sequential Application (Happy Path)
  // Criterion: Taux application réussie ≥99%
  // ============================================

  describe('Sequential Promotion Application', () => {
    test('should apply promotions sequentially in correct order', async () => {
      const subtotal = 200;

      // Mock AUTO promotion
      prisma.promotion.findMany.mockResolvedValue([
        {
          id: 'auto-1',
          code: 'AUTO10',
          type: 'PERCENTAGE',
          tag: 'AUTO',
          value: 10, // 10% off
          active: true,
          expiresAt: null,
          usageLimitPerUser: 1,
        },
      ]);

      // Mock manual STACKABLE promotion
      prisma.promotion.findUnique.mockResolvedValue({
        id: 'stack-1',
        code: 'STACK20',
        type: 'FIXED_AMOUNT',
        tag: 'STACKABLE',
        value: 20,
        active: true,
        expiresAt: null,
        usageLimitPerUser: 1,
      });

      prisma.promotionUsage.findUnique.mockResolvedValue(null);

      const result = await validateAndApplyPromotions('user-1', subtotal, ['STACK20']);

      // Step 1: AUTO10 (10% of 200) = 20 off → 180
      // Step 2: STACK20 (20 fixed) = 20 off → 160
      expect(result.finalAmount).toBe(160);
      expect(result.totalDiscount).toBe(40);
      expect(result.appliedPromotions).toHaveLength(2);
      expect(result.appliedPromotions[0].code).toBe('AUTO10'); // AUTO first
      expect(result.appliedPromotions[1].code).toBe('STACK20'); // STACKABLE second
    });

    test('should handle EXCLUSIVE promotion alone', async () => {
      const subtotal = 100;

      prisma.promotion.findMany.mockResolvedValue([]); // No AUTO promos

      prisma.promotion.findUnique.mockResolvedValue({
        id: 'excl-1',
        code: 'EXCLUSIVE50',
        type: 'PERCENTAGE',
        tag: 'EXCLUSIVE',
        value: 50, // 50% off
        active: true,
        expiresAt: null,
        usageLimitPerUser: 1,
      });

      prisma.promotionUsage.findUnique.mockResolvedValue(null);

      const result = await validateAndApplyPromotions('user-1', subtotal, ['EXCLUSIVE50']);

      expect(result.finalAmount).toBe(50);
      expect(result.totalDiscount).toBe(50);
      expect(result.appliedPromotions).toHaveLength(1);
      expect(result.appliedPromotions[0].tag).toBe('EXCLUSIVE');
    });
  });

  // ============================================
  // TEST 6: Usage Limit Validation
  // Criterion: Respect limites usage 100%
  // ============================================

  describe('Usage Limit Validation', () => {
    test('should reject promotion when usage limit exceeded', async () => {
      const subtotal = 100;

      prisma.promotion.findMany.mockResolvedValue([]);

      prisma.promotion.findUnique.mockResolvedValue({
        id: 'promo-1',
        code: 'LIMITED',
        type: 'PERCENTAGE',
        tag: 'STACKABLE',
        value: 10,
        active: true,
        expiresAt: null,
        usageLimitPerUser: 1, // Max 1 usage
      });

      // Mock usage already at limit
      prisma.promotionUsage.findUnique.mockResolvedValue({
        userId: 'user-1',
        promotionId: 'promo-1',
        count: 1, // Already used once
      });

      const result = await validateAndApplyPromotions('user-1', subtotal, ['LIMITED']);

      expect(result.invalidCodes).toHaveLength(1);
      expect(result.invalidCodes[0].code).toBe('LIMITED');
      expect(result.invalidCodes[0].reason).toBe('USAGE_LIMIT_EXCEEDED');
      expect(result.appliedPromotions).toHaveLength(0);
    });

    test('should allow promotion when within usage limit', async () => {
      const subtotal = 100;

      prisma.promotion.findMany.mockResolvedValue([]);

      prisma.promotion.findUnique.mockResolvedValue({
        id: 'promo-1',
        code: 'LIMITED3',
        type: 'PERCENTAGE',
        tag: 'STACKABLE',
        value: 10,
        active: true,
        expiresAt: null,
        usageLimitPerUser: 3, // Max 3 usages
      });

      // Mock usage at 2 (still has 1 remaining)
      prisma.promotionUsage.findUnique.mockResolvedValue({
        userId: 'user-1',
        promotionId: 'promo-1',
        count: 2,
      });

      const result = await validateAndApplyPromotions('user-1', subtotal, ['LIMITED3']);

      expect(result.invalidCodes).toHaveLength(0);
      expect(result.appliedPromotions).toHaveLength(1);
      expect(result.appliedPromotions[0].code).toBe('LIMITED3');
    });
  });

  // ============================================
  // TEST 7: Validation Errors
  // Criterion: Clarté messages erreur ≥90%
  // ============================================

  describe('Validation Errors', () => {
    test('should reject invalid subtotal (zero)', async () => {
      await expect(
        validateAndApplyPromotions('user-1', 0, [])
      ).rejects.toThrow('INVALID_SUBTOTAL: Subtotal must be greater than 0');
    });

    test('should reject invalid subtotal (negative)', async () => {
      await expect(
        validateAndApplyPromotions('user-1', -50, [])
      ).rejects.toThrow('INVALID_SUBTOTAL');
    });

    test('should mark non-existent promotion code as invalid', async () => {
      prisma.promotion.findMany.mockResolvedValue([]);
      prisma.promotion.findUnique.mockResolvedValue(null); // Code not found

      const result = await validateAndApplyPromotions('user-1', 100, ['NOTFOUND']);

      expect(result.invalidCodes).toHaveLength(1);
      expect(result.invalidCodes[0].code).toBe('NOTFOUND');
      expect(result.invalidCodes[0].reason).toBe('PROMOTION_NOT_FOUND');
    });

    test('should mark inactive promotion as invalid', async () => {
      prisma.promotion.findMany.mockResolvedValue([]);

      prisma.promotion.findUnique.mockResolvedValue({
        id: 'promo-1',
        code: 'INACTIVE',
        active: false, // Inactive
        expiresAt: null,
      });

      const result = await validateAndApplyPromotions('user-1', 100, ['INACTIVE']);

      expect(result.invalidCodes).toHaveLength(1);
      expect(result.invalidCodes[0].reason).toBe('PROMOTION_INACTIVE');
    });

    test('should mark expired promotion as invalid', async () => {
      prisma.promotion.findMany.mockResolvedValue([]);

      const pastDate = new Date('2020-01-01');

      prisma.promotion.findUnique.mockResolvedValue({
        id: 'promo-1',
        code: 'EXPIRED',
        active: true,
        expiresAt: pastDate, // Expired
      });

      const result = await validateAndApplyPromotions('user-1', 100, ['EXPIRED']);

      expect(result.invalidCodes).toHaveLength(1);
      expect(result.invalidCodes[0].reason).toBe('PROMOTION_EXPIRED');
    });
  });

  // ============================================
  // TEST 8: Idempotence
  // Criterion: Idempotence 100%
  // ============================================

  describe('Idempotence', () => {
    test('should produce same result when called multiple times', async () => {
      const subtotal = 150;

      prisma.promotion.findMany.mockResolvedValue([
        {
          id: 'auto-1',
          code: 'AUTO15',
          type: 'PERCENTAGE',
          tag: 'AUTO',
          value: 15,
          active: true,
          expiresAt: null,
          usageLimitPerUser: 1,
        },
      ]);

      prisma.promotionUsage.findUnique.mockResolvedValue(null);

      // Call twice with same parameters
      const result1 = await validateAndApplyPromotions('user-1', subtotal, []);
      const result2 = await validateAndApplyPromotions('user-1', subtotal, []);

      // Results should be identical (pure calculation)
      expect(result1.finalAmount).toBe(result2.finalAmount);
      expect(result1.totalDiscount).toBe(result2.totalDiscount);
      expect(result1.appliedPromotions).toEqual(result2.appliedPromotions);
    });
  });

  // ============================================
  // TEST 9: Increment Usage
  // Criterion: Traceability complete 100%
  // ============================================

  describe('Increment Promotion Usage', () => {
    test('should create usage record for first-time use', async () => {
      prisma.promotionUsage.upsert.mockResolvedValue({
        userId: 'user-1',
        promotionId: 'promo-1',
        count: 1,
      });

      await incrementPromotionUsage('user-1', ['promo-1']);

      expect(prisma.promotionUsage.upsert).toHaveBeenCalledWith({
        where: {
          userId_promotionId: {
            userId: 'user-1',
            promotionId: 'promo-1',
          },
        },
        create: {
          userId: 'user-1',
          promotionId: 'promo-1',
          count: 1,
        },
        update: {
          count: { increment: 1 },
        },
      });
    });

    test('should increment existing usage count', async () => {
      prisma.promotionUsage.upsert.mockResolvedValue({
        userId: 'user-1',
        promotionId: 'promo-1',
        count: 2,
      });

      await incrementPromotionUsage('user-1', ['promo-1']);

      expect(prisma.promotionUsage.upsert).toHaveBeenCalled();
    });

    test('should handle multiple promotions', async () => {
      prisma.promotionUsage.upsert.mockResolvedValue({});

      await incrementPromotionUsage('user-1', ['promo-1', 'promo-2', 'promo-3']);

      expect(prisma.promotionUsage.upsert).toHaveBeenCalledTimes(3);
    });
  });

  // ============================================
  // TEST 10: Get User Usage Stats
  // Criterion: Traceability complete 100%
  // ============================================

  describe('Get User Promotion Usage', () => {
    test('should return usage stats for user', async () => {
      prisma.promotionUsage.findMany.mockResolvedValue([
        {
          userId: 'user-1',
          promotionId: 'promo-1',
          count: 2,
          promotion: {
            id: 'promo-1',
            code: 'SUMMER20',
            usageLimitPerUser: 3,
          },
        },
        {
          userId: 'user-1',
          promotionId: 'promo-2',
          count: 1,
          promotion: {
            id: 'promo-2',
            code: 'WELCOME10',
            usageLimitPerUser: 1,
          },
        },
      ]);

      const result = await getUserPromotionUsage('user-1');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        promotionId: 'promo-1',
        code: 'SUMMER20',
        count: 2,
        limit: 3,
        remaining: 1,
      });
      expect(result[1]).toEqual({
        promotionId: 'promo-2',
        code: 'WELCOME10',
        count: 1,
        limit: 1,
        remaining: 0,
      });
    });

    test('should return empty array for user with no usage', async () => {
      prisma.promotionUsage.findMany.mockResolvedValue([]);

      const result = await getUserPromotionUsage('user-new');

      expect(result).toEqual([]);
    });
  });

  // ============================================
  // TEST 11: Edge Cases
  // ============================================

  describe('Edge Cases', () => {
    test('should handle empty promotion codes array', async () => {
      prisma.promotion.findMany.mockResolvedValue([]);

      const result = await validateAndApplyPromotions('user-1', 100, []);

      expect(result.finalAmount).toBe(100); // No discounts
      expect(result.totalDiscount).toBe(0);
      expect(result.appliedPromotions).toHaveLength(0);
      expect(result.invalidCodes).toHaveLength(0);
    });

    test('should stop applying promotions when amount reaches 0', async () => {
      const subtotal = 50;

      prisma.promotion.findMany.mockResolvedValue([
        {
          id: 'auto-1',
          code: 'AUTO100',
          type: 'PERCENTAGE',
          tag: 'AUTO',
          value: 100, // 100% off
          active: true,
          expiresAt: null,
          usageLimitPerUser: 1,
        },
      ]);

      prisma.promotion.findUnique.mockResolvedValue({
        id: 'stack-1',
        code: 'STACK10',
        type: 'FIXED_AMOUNT',
        tag: 'STACKABLE',
        value: 10,
        active: true,
        expiresAt: null,
        usageLimitPerUser: 1,
      });

      prisma.promotionUsage.findUnique.mockResolvedValue(null);

      const result = await validateAndApplyPromotions('user-1', subtotal, ['STACK10']);

      // AUTO100 brings it to 0, STACK10 should not be applied
      expect(result.finalAmount).toBe(0);
      expect(result.appliedPromotions).toHaveLength(1); // Only AUTO100 applied
      expect(result.appliedPromotions[0].code).toBe('AUTO100');
    });
  });
});
