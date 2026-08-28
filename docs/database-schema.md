# QuotePlate database schema

## Enums

### UserRole

- `OWNER`
- `MEMBER`

### MenuStatus

- `DRAFT`
- `APPROVED`

### ProcurementRequestStatus

- `DRAFT`
- `OPEN`
- `AWARDED`
- `CANCELLED`

### ProcurementUnit

- `KILOGRAM`
- `GRAM`
- `LITRE`
- `MILLILITRE`
- `PIECE`
- `PACK`
- `CASE`
- `CRATE`

## Tenant

- `id`: `String`
- `name`: `String`
- `addressLine`: `String`
- `city`: `String`
- `state`: `String`
- `pin`: `String`
- `phone`: `String`
- `timezone`: `String`
- `gstin`: `String?`
- `isActive`: `Boolean`
- `createdAt`: `DateTime`
- `updatedAt`: `DateTime`

## User

- `id`: `String`
- `tenantId`: `String`
- `name`: `String`
- `email`: `String`
- `passwordHash`: `String?`
- `legacyPasswordSalt`: `String?`
- `role`: `UserRole`
- `isActive`: `Boolean`
- `lastLoginAt`: `DateTime?`
- `createdAt`: `DateTime`
- `updatedAt`: `DateTime`

## ExternalIdentity

- `tenantId`: `String`
- `userId`: `String`
- `provider`: `String`
- `providerAccountId`: `String`
- `createdAt`: `DateTime`

## Invitation

- `id`: `String`
- `tenantId`: `String`
- `email`: `String`
- `role`: `UserRole`
- `tokenDigest`: `String`
- `expiresAt`: `DateTime`
- `acceptedAt`: `DateTime?`
- `revokedAt`: `DateTime?`
- `invitedByUserId`: `String`
- `createdAt`: `DateTime`

## Menu

- `id`: `String`
- `tenantId`: `String`
- `name`: `String`
- `sourceText`: `String?`
- `status`: `MenuStatus`
- `version`: `Int`
- `approvedAt`: `DateTime?`
- `approvedByUserId`: `String?`
- `createdByUserId`: `String?`
- `createdAt`: `DateTime`
- `updatedAt`: `DateTime`

## Recipe

- `id`: `String`
- `tenantId`: `String`
- `menuId`: `String`
- `name`: `String`
- `position`: `Int`

## Ingredient

- `id`: `String`
- `tenantId`: `String`
- `recipeId`: `String`
- `name`: `String`
- `quantity`: `Decimal`
- `unit`: `ProcurementUnit`
- `position`: `Int`

## Supplier

- `id`: `String`
- `tenantId`: `String`
- `businessName`: `String`
- `contactName`: `String?`
- `phone`: `String?`
- `whatsappNumber`: `String?`
- `email`: `String?`
- `addressLine`: `String?`
- `city`: `String?`
- `state`: `String?`
- `pin`: `String?`
- `gstin`: `String?`
- `notes`: `String?`
- `isActive`: `Boolean`
- `createdAt`: `DateTime`
- `updatedAt`: `DateTime`

## ProcurementRequest

- `id`: `String`
- `tenantId`: `String`
- `title`: `String`
- `status`: `ProcurementRequestStatus`
- `version`: `Int`
- `menuId`: `String?`
- `sourceRequestId`: `String?`
- `deliveryDetails`: `Json`
- `deliveryDate`: `DateTime`
- `quoteDeadline`: `DateTime`
- `commercialTerms`: `String?`
- `openedAt`: `DateTime?`
- `awardedAt`: `DateTime?`
- `cancelledAt`: `DateTime?`
- `createdByUserId`: `String`
- `createdAt`: `DateTime`
- `updatedAt`: `DateTime`

## RequestItem

- `id`: `String`
- `tenantId`: `String`
- `requestId`: `String`
- `name`: `String`
- `quantity`: `Decimal`
- `unit`: `ProcurementUnit`
- `createdAt`: `DateTime`

## SupplierRequest

- `id`: `String`
- `tenantId`: `String`
- `requestId`: `String`
- `supplierId`: `String`
- `tokenDigest`: `String`
- `expiresAt`: `DateTime`
- `revokedAt`: `DateTime?`
- `viewedAt`: `DateTime?`
- `createdAt`: `DateTime`

## SupplierQuote

- `id`: `String`
- `tenantId`: `String`
- `supplierRequestId`: `String`
- `revision`: `Int`
- `subtotalPaise`: `BigInt`
- `gstPaise`: `BigInt`
- `freightPaise`: `BigInt`
- `totalPaise`: `BigInt`
- `deliveryDate`: `DateTime`
- `validUntil`: `DateTime`
- `commercialTerms`: `String?`
- `notes`: `String?`
- `submittedAt`: `DateTime`

## SupplierQuoteItem

- `id`: `String`
- `tenantId`: `String`
- `quoteId`: `String`
- `requestItemId`: `String`
- `noQuote`: `Boolean`
- `availableQuantity`: `Decimal?`
- `unit`: `ProcurementUnit?`
- `unitRatePaise`: `BigInt?`
- `gstBasisPoints`: `Int?`
- `taxInclusive`: `Boolean`
- `substitution`: `String?`
- `subtotalPaise`: `BigInt`
- `gstPaise`: `BigInt`
- `totalPaise`: `BigInt`

## Award

- `id`: `String`
- `tenantId`: `String`
- `requestId`: `String`
- `rationale`: `String?`
- `supplierSnapshots`: `Json`
- `deliverySnapshot`: `Json`
- `totalPaise`: `BigInt`
- `awardedByUserId`: `String`
- `createdAt`: `DateTime`

## AwardLine

- `id`: `String`
- `tenantId`: `String`
- `awardId`: `String`
- `requestItemId`: `String`
- `supplierQuoteItemId`: `String`
- `supplierId`: `String`
- `quantity`: `Decimal`
- `unit`: `ProcurementUnit`
- `unitRatePaise`: `BigInt`
- `gstBasisPoints`: `Int`
- `subtotalPaise`: `BigInt`
- `gstPaise`: `BigInt`
- `totalPaise`: `BigInt`

## AuditEvent

- `id`: `String`
- `tenantId`: `String`
- `actorUserId`: `String?`
- `action`: `String`
- `entityType`: `String`
- `entityId`: `String`
- `metadata`: `Json?`
- `createdAt`: `DateTime`

## RateLimitBucket

- `keyDigest`: `String`
- `count`: `Int`
- `resetAt`: `DateTime`
- `updatedAt`: `DateTime`
