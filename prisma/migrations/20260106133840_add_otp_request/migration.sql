-- CreateTable
CREATE TABLE "OtpRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phoneE164" TEXT NOT NULL,
    "otpHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "OtpRequest_phoneE164_idx" ON "OtpRequest"("phoneE164");

-- CreateIndex
CREATE INDEX "OtpRequest_expiresAt_idx" ON "OtpRequest"("expiresAt");

-- CreateIndex
CREATE INDEX "OtpRequest_usedAt_idx" ON "OtpRequest"("usedAt");
