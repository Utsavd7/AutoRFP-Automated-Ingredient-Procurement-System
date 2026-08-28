-- CreateTable
CREATE TABLE "Menu" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "sourceUrl" TEXT,
    "text" TEXT,
    "mealName" TEXT,
    "guestCount" INTEGER,
    "bufferPct" DOUBLE PRECISION,
    "requestedIngredients" JSONB,
    "workflowStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Menu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "restaurantName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "passwordSalt" TEXT,
    "location" TEXT NOT NULL,
    "cuisineType" TEXT,
    "preferredSuppliers" TEXT[],
    "monthlyBudgetTarget" DOUBLE PRECISION,
    "savingsTargetPct" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipe" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION,
    "unit" TEXT,
    "recipeId" TEXT NOT NULL,

    CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingTrend" (
    "id" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "PricingTrend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Distributor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "email" TEXT NOT NULL,
    "location" TEXT NOT NULL,

    CONSTRAINT "Distributor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RFP" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "tenantId" TEXT,
    "distributorId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "negotiatedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RFP_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "rfpId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcurementRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "menuText" TEXT,
    "totalSpend" DOUBLE PRECISION,
    "totalSavings" DOUBLE PRECISION,
    "savingsPercentage" DOUBLE PRECISION,
    "bestVendor" TEXT,
    "winnerPrice" DOUBLE PRECISION,
    "recipesCount" INTEGER NOT NULL DEFAULT 0,
    "ingredientsCount" INTEGER NOT NULL DEFAULT 0,
    "distributorsCount" INTEGER NOT NULL DEFAULT 0,
    "quotesCount" INTEGER NOT NULL DEFAULT 0,
    "executiveSummary" TEXT,
    "marketAlerts" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcurementRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Menu_tenantId_idx" ON "Menu"("tenantId");

-- CreateIndex
CREATE INDEX "RFP_tenantId_idx" ON "RFP"("tenantId");

-- CreateIndex
CREATE INDEX "RFP_menuId_tenantId_idx" ON "RFP"("menuId", "tenantId");

-- CreateIndex
CREATE INDEX "ProcurementRun_tenantId_createdAt_idx" ON "ProcurementRun"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "Menu" ADD CONSTRAINT "Menu_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingTrend" ADD CONSTRAINT "PricingTrend_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFP" ADD CONSTRAINT "RFP_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFP" ADD CONSTRAINT "RFP_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_rfpId_fkey" FOREIGN KEY ("rfpId") REFERENCES "RFP"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementRun" ADD CONSTRAINT "ProcurementRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
