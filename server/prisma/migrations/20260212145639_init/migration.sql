-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CART', 'CHECKOUT', 'PAID', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'EXPIRED', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING');

-- CreateEnum
CREATE TYPE "PromotionTag" AS ENUM ('EXCLUSIVE', 'STACKABLE', 'AUTO');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentErrorType" AS ENUM ('INSUFFICIENT_FUNDS', 'CARD_DECLINED', 'CARD_EXPIRED', 'FRAUD_SUSPECTED', 'GATEWAY_TIMEOUT', 'NETWORK_ERROR', 'THREE_DS_TIMEOUT', 'TECHNICAL_ERROR');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'CART',
    "version" INTEGER NOT NULL DEFAULT 0,
    "itemsSnapshot" JSONB,
    "totalSnapshot" DECIMAL(10,2),
    "promoSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkoutAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paymentId" TEXT,
    "recoveryEmailSent" BOOLEAN NOT NULL DEFAULT false,
    "recoveryToken" TEXT,
    "recoveryTokenExpiresAt" TIMESTAMP(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "stockTotal" INTEGER NOT NULL,
    "stockAvailable" INTEGER NOT NULL,
    "stockReserved" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReservation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "PromotionType" NOT NULL,
    "tag" "PromotionTag" NOT NULL,
    "value" DECIMAL(10,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "usageLimitPerUser" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionUsage" (
    "userId" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromotionUsage_pkey" PRIMARY KEY ("userId","promotionId")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paymentMethod" TEXT,
    "errorCode" TEXT,
    "errorType" "PaymentErrorType",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStateAudit" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromState" "OrderStatus" NOT NULL,
    "toState" "OrderStatus" NOT NULL,
    "reason" TEXT,
    "actor" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStateAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartRecoveryLog" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clickedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartRecoveryLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Order_recoveryToken_key" ON "Order"("recoveryToken");

-- CreateIndex
CREATE INDEX "Order_userId_status_idx" ON "Order"("userId", "status");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "Order_recoveryEmailSent_createdAt_idx" ON "Order"("recoveryEmailSent", "createdAt");

-- CreateIndex
CREATE INDEX "Order_recoveryToken_idx" ON "Order"("recoveryToken");

-- CreateIndex
CREATE INDEX "Product_stockAvailable_idx" ON "Product"("stockAvailable");

-- CreateIndex
CREATE INDEX "StockReservation_orderId_idx" ON "StockReservation"("orderId");

-- CreateIndex
CREATE INDEX "StockReservation_status_expiresAt_idx" ON "StockReservation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "StockReservation_productId_idx" ON "StockReservation"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "StockReservation_orderId_productId_key" ON "StockReservation"("orderId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "Promotion_code_key" ON "Promotion"("code");

-- CreateIndex
CREATE INDEX "Promotion_active_expiresAt_idx" ON "Promotion"("active", "expiresAt");

-- CreateIndex
CREATE INDEX "Promotion_tag_active_idx" ON "Promotion"("tag", "active");

-- CreateIndex
CREATE INDEX "PromotionUsage_userId_idx" ON "PromotionUsage"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_orderId_key" ON "PaymentAttempt"("orderId");

-- CreateIndex
CREATE INDEX "PaymentAttempt_orderId_status_idx" ON "PaymentAttempt"("orderId", "status");

-- CreateIndex
CREATE INDEX "PaymentAttempt_status_idx" ON "PaymentAttempt"("status");

-- CreateIndex
CREATE INDEX "OrderStateAudit_orderId_timestamp_idx" ON "OrderStateAudit"("orderId", "timestamp");

-- CreateIndex
CREATE INDEX "OrderStateAudit_timestamp_idx" ON "OrderStateAudit"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "CartRecoveryLog_orderId_key" ON "CartRecoveryLog"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "CartRecoveryLog_token_key" ON "CartRecoveryLog"("token");

-- CreateIndex
CREATE INDEX "CartRecoveryLog_orderId_idx" ON "CartRecoveryLog"("orderId");

-- CreateIndex
CREATE INDEX "CartRecoveryLog_userId_idx" ON "CartRecoveryLog"("userId");

-- CreateIndex
CREATE INDEX "CartRecoveryLog_emailSentAt_idx" ON "CartRecoveryLog"("emailSentAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionUsage" ADD CONSTRAINT "PromotionUsage_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStateAudit" ADD CONSTRAINT "OrderStateAudit_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartRecoveryLog" ADD CONSTRAINT "CartRecoveryLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
