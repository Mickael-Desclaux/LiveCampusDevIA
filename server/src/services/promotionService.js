const prisma = require('../prisma');

// ============================================
// CONSTANTS - Compatibility Matrix
// ============================================

// Promotion compatibility rules (hardcoded)
// Rule 1: MAX 1 EXCLUSIVE promotion
// Rule 2: EXCLUSIVE incompatible with any other promotion
// Rule 3: STACKABLE can combine with other STACKABLE
// Rule 4: AUTO can combine with STACKABLE
// Rule 5: AUTO cannot combine with EXCLUSIVE
// Rule 6: Multiple AUTO promotions can combine

// Deterministic application order
const PROMOTION_ORDER = {
  AUTO: 1,
  STACKABLE: 2,
  EXCLUSIVE: 3,
};

// ============================================
// VALIDATION FUNCTIONS
// ============================================

/**
 * Validate promotion compatibility matrix
 * - Max 1 EXCLUSIVE promotion
 * - EXCLUSIVE incompatible with any other tags
 * - STACKABLE + AUTO can combine
 */
function validatePromotionCompatibility(promotions) {
  const tags = promotions.map(p => p.tag);
  const exclusiveCount = tags.filter(t => t === 'EXCLUSIVE').length;
  const hasExclusive = exclusiveCount > 0;
  const hasOtherTags = tags.some(t => t !== 'EXCLUSIVE');

  // Rule 1 & 2: Max 1 EXCLUSIVE, and EXCLUSIVE is incompatible with others
  if (exclusiveCount > 1) {
    throw new Error('INCOMPATIBLE_PROMOTIONS: Only one EXCLUSIVE promotion allowed');
  }

  if (hasExclusive && hasOtherTags) {
    throw new Error('INCOMPATIBLE_PROMOTIONS: EXCLUSIVE promotions cannot be combined with others');
  }

  return true;
}

/**
 * Check if user has exceeded usage limit for a promotion
 */
async function validateUsageLimit(userId, promotionId, usageLimitPerUser) {
  const usage = await prisma.promotionUsage.findUnique({
    where: {
      userId_promotionId: {
        userId,
        promotionId,
      },
    },
  });

  if (usage && usage.count >= usageLimitPerUser) {
    return false; // Limit exceeded
  }

  return true; // Within limit
}

/**
 * Sort promotions by deterministic order (AUTO → STACKABLE → EXCLUSIVE)
 */
function sortPromotionsByOrder(promotions) {
  return [...promotions].sort((a, b) => {
    return PROMOTION_ORDER[a.tag] - PROMOTION_ORDER[b.tag];
  });
}

// ============================================
// CALCULATION FUNCTIONS
// ============================================

/**
 * Calculate discount amount for a single promotion
 */
function calculateSingleDiscount(subtotal, promotion) {
  switch (promotion.type) {
    case 'PERCENTAGE':
      return (subtotal * parseFloat(promotion.value)) / 100;

    case 'FIXED_AMOUNT':
      return parseFloat(promotion.value);

    case 'FREE_SHIPPING':
      // Free shipping discount is handled separately (not applied to subtotal)
      return 0;

    default:
      throw new Error(`UNKNOWN_PROMOTION_TYPE: ${promotion.type}`);
  }
}

/**
 * Apply promotions sequentially to subtotal
 * Returns final amount and applied promotions details
 */
function applyPromotionsSequentially(subtotal, promotions) {
  let currentAmount = subtotal;
  const appliedPromotions = [];

  for (const promotion of promotions) {
    const discountAmount = calculateSingleDiscount(currentAmount, promotion);
    const newAmount = Math.max(0, currentAmount - discountAmount); // Protection: final amount >= 0

    appliedPromotions.push({
      code: promotion.code,
      type: promotion.type,
      tag: promotion.tag,
      value: parseFloat(promotion.value),
      discountAmount: parseFloat(discountAmount.toFixed(2)),
      amountBefore: parseFloat(currentAmount.toFixed(2)),
      amountAfter: parseFloat(newAmount.toFixed(2)),
    });

    currentAmount = newAmount;

    // If amount reaches 0, stop applying further promotions
    if (currentAmount === 0) {
      break;
    }
  }

  return {
    finalAmount: parseFloat(currentAmount.toFixed(2)),
    totalDiscount: parseFloat((subtotal - currentAmount).toFixed(2)),
    appliedPromotions,
  };
}

// ============================================
// MAIN SERVICE FUNCTIONS
// ============================================

/**
 * Validate and apply promotions to cart
 *
 * Two-phase process for idempotence:
 * Phase 1: VALIDATE - Check codes, limits, compatibility
 * Phase 2: APPLY - Calculate discounts (pure calculation, no side effects)
 *
 * @param {string} userId - User ID
 * @param {number} subtotal - Cart subtotal before promotions
 * @param {string[]} promoCodes - Array of promotion codes to apply
 * @returns {Promise<Object>} - { finalAmount, totalDiscount, appliedPromotions, invalidCodes }
 */
async function validateAndApplyPromotions(userId, subtotal, promoCodes = []) {
  // Validation: subtotal must be > 0
  if (subtotal <= 0) {
    throw new Error('INVALID_SUBTOTAL: Subtotal must be greater than 0');
  }

  // === PHASE 1: VALIDATE ===

  const validPromotions = [];
  const invalidCodes = [];

  // Step 1: Retrieve AUTO promotions (active, not expired)
  const now = new Date();
  const autoPromotions = await prisma.promotion.findMany({
    where: {
      tag: 'AUTO',
      active: true,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } },
      ],
    },
  });

  validPromotions.push(...autoPromotions);

  // Step 2: Validate manual promotion codes
  if (promoCodes.length > 0) {
    for (const code of promoCodes) {
      const promotion = await prisma.promotion.findUnique({
        where: { code },
      });

      // Check if promotion exists
      if (!promotion) {
        invalidCodes.push({ code, reason: 'PROMOTION_NOT_FOUND' });
        continue;
      }

      // Check if active
      if (!promotion.active) {
        invalidCodes.push({ code, reason: 'PROMOTION_INACTIVE' });
        continue;
      }

      // Check if expired
      if (promotion.expiresAt && promotion.expiresAt <= now) {
        invalidCodes.push({ code, reason: 'PROMOTION_EXPIRED' });
        continue;
      }

      // Check usage limit
      const withinLimit = await validateUsageLimit(
        userId,
        promotion.id,
        promotion.usageLimitPerUser
      );

      if (!withinLimit) {
        invalidCodes.push({ code, reason: 'USAGE_LIMIT_EXCEEDED' });
        continue;
      }

      validPromotions.push(promotion);
    }
  }

  // Step 3: Validate compatibility matrix
  try {
    validatePromotionCompatibility(validPromotions);
  } catch (err) {
    throw err; // Propagate incompatibility error
  }

  // Step 4: Sort by deterministic order
  const sortedPromotions = sortPromotionsByOrder(validPromotions);

  // === PHASE 2: APPLY ===

  // Step 5: Calculate discounts sequentially
  const result = applyPromotionsSequentially(subtotal, sortedPromotions);

  return {
    ...result,
    invalidCodes,
  };
}

/**
 * Increment promotion usage count for a user
 * Call this after successful order creation
 *
 * @param {string} userId - User ID
 * @param {string[]} promotionIds - Array of promotion IDs that were applied
 */
async function incrementPromotionUsage(userId, promotionIds) {
  for (const promotionId of promotionIds) {
    await prisma.promotionUsage.upsert({
      where: {
        userId_promotionId: {
          userId,
          promotionId,
        },
      },
      create: {
        userId,
        promotionId,
        count: 1,
      },
      update: {
        count: { increment: 1 },
      },
    });
  }
}

/**
 * Get promotion usage stats for a user
 *
 * @param {string} userId - User ID
 * @returns {Promise<Object[]>} - Array of { promotionId, code, count, limit }
 */
async function getUserPromotionUsage(userId) {
  const usages = await prisma.promotionUsage.findMany({
    where: { userId },
    include: {
      promotion: {
        select: {
          id: true,
          code: true,
          usageLimitPerUser: true,
        },
      },
    },
  });

  return usages.map(usage => ({
    promotionId: usage.promotionId,
    code: usage.promotion.code,
    count: usage.count,
    limit: usage.promotion.usageLimitPerUser,
    remaining: Math.max(0, usage.promotion.usageLimitPerUser - usage.count),
  }));
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  validateAndApplyPromotions,
  incrementPromotionUsage,
  getUserPromotionUsage,
  // Export for testing
  validatePromotionCompatibility,
  sortPromotionsByOrder,
  calculateSingleDiscount,
  PROMOTION_ORDER,
};
