-- CreateTable
CREATE TABLE "PenaltyPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'SELF_UNBLOCK',
    "method" TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
    "status" TEXT NOT NULL DEFAULT 'INITIATED',
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ALL',
    "reference" TEXT NOT NULL,
    "proofUrl" TEXT,
    "bankTxnRef" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PenaltyPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PenaltyPayment_reference_key" ON "PenaltyPayment"("reference");

-- CreateIndex
CREATE INDEX "PenaltyPayment_userId_idx" ON "PenaltyPayment"("userId");

-- CreateIndex
CREATE INDEX "PenaltyPayment_status_idx" ON "PenaltyPayment"("status");

-- CreateIndex
CREATE INDEX "PenaltyPayment_expiresAt_idx" ON "PenaltyPayment"("expiresAt");
