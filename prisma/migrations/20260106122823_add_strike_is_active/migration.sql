-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Strike" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Strike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Strike" ("createdAt", "id", "reason", "userId") SELECT "createdAt", "id", "reason", "userId" FROM "Strike";
DROP TABLE "Strike";
ALTER TABLE "new_Strike" RENAME TO "Strike";
CREATE INDEX "Strike_userId_idx" ON "Strike"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
