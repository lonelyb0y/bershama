// Domain types.
//
// Hand-written rather than generated. The database is the source of truth and
// the shape here mirrors it 1:1, but keeping the types explicit means a
// migration that changes a column is a type error the compiler catches rather
// than a silent mismatch that only shows up at runtime in a pharmacy.
//
// MONEY: every amount is `Minor` — an integer count of currency minor units
// (piastres for EGP). Never `number` decimals. A float that survives a round
// trip through a ledger is a rounding error you cannot explain to an auditor.

/** Integer minor units. 1 EGP = 100 piastres. */
export type Minor = number;

export type CurrencyCode = 'EGP' | 'SAR' | 'AED' | 'USD';

export type AppRole =
  | 'TENANT_ADMIN'
  | 'WAREHOUSE_MANAGER'
  | 'DISPATCHER'
  | 'PHARMACY_MANAGER'
  | 'DISTRIBUTOR'
  | 'ANALYST';

export type FacilityKind = 'WAREHOUSE' | 'PHARMACY' | 'HOSPITAL' | 'CLINIC';

export type LocationKind =
  | 'RECEIVING'
  | 'QUARANTINE'
  | 'AMBIENT'
  | 'COLD'
  | 'FREEZER'
  | 'IN_TRANSIT'
  | 'BIN'
  | 'DISPENSE';

export type BatchStatus =
  | 'QUARANTINED'
  | 'RELEASED'
  | 'RECALLED'
  | 'EXPIRED'
  | 'DEPLETED';

export type RequisitionStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'ALLOCATED'
  | 'DISPATCHED'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'CLOSED';

export type StopStatus =
  | 'PENDING'
  | 'ARRIVED'
  | 'DELIVERED'
  | 'FAILED'
  | 'RETURNED'
  | 'SKIPPED';

export type AlertType =
  | 'LOW_STOCK'
  | 'NEAR_EXPIRY'
  | 'EXPIRED'
  | 'OVERSTOCK'
  | 'ORDER_OVERDUE'
  | 'DELIVERY_FAILED'
  | 'COLD_CHAIN_BREACH'
  | 'RECALL';

export type AlertSeverity = 'INFO' | 'WARN' | 'CRITICAL';

/**
 * Movement types recorded in the stock ledger.
 *
 * Every change to stock is one of these, signed positive or negative. The ledger
 * is append-only, so a mistake is corrected with a compensating movement rather
 * than an edit, which is what WHO GDP requires and what makes the history
 * defensible.
 */
export type MovementType =
  | 'RECEIPT'
  | 'ISSUE'
  | 'DISPENSE'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'ADJUSTMENT'
  | 'COUNT_GAIN'
  | 'COUNT_LOSS'
  | 'RETURN'
  | 'WRITE_OFF'
  | 'RECALL_QUARANTINE'
  | 'RECALL_RELEASE';

// ── entities ────────────────────────────────────────────────────────────────

export interface Tenant {
  id: string;
  slug: string;
  nameEn: string;
  nameAr: string | null;
  countryCode: string;
  currencyCode: CurrencyCode;
  vatRate: number;
  timezone: string;
  localeDefault: 'en' | 'ar';
  /** Minimum remaining shelf life, as a percentage of total, for FEFO to allocate. */
  minShelfLifePct: number;
}

export interface Profile {
  id: string;
  tenantId: string;
  role: AppRole;
  fullName: string;
  fullNameAr: string | null;
  phone: string | null;
  locale: 'en' | 'ar';
  isActive: boolean;
  lastSeenAt: string | null;
}

/** Return value of api.whoami(): identity, tenant and role in one round trip. */
export interface SessionInfo {
  userId: string;
  tenantId: string;
  role: AppRole;
  fullName: string;
  locale: 'en' | 'ar';
  tenantSlug: string;
  currencyCode: CurrencyCode;
  vatRate: number;
  timezone: string;
}

export interface Facility {
  id: string;
  tenantId: string;
  kind: FacilityKind;
  code: string;
  nameEn: string;
  nameAr: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  licenseNo: string | null;
  isActive: boolean;
}

export interface StorageLocation {
  id: string;
  tenantId: string;
  facilityId: string;
  kind: LocationKind;
  code: string;
  nameEn: string;
  nameAr: string | null;
  /** Cold-chain range in Celsius. Null for ambient locations. */
  tempMinC: number | null;
  tempMaxC: number | null;
}

export interface Product {
  id: string;
  tenantId: string;
  sku: string;
  /**
   * Both names are required. Egyptian pharmacies stock and order bilingual
   * packaging, so a single-name product record is unusable in practice.
   */
  nameEn: string;
  nameAr: string;
  genericNameEn: string | null;
  genericNameAr: string | null;
  brand: string | null;
  form: string;
  strength: string;
  packSize: number;
  uom: string;
  /** ATC code — the WHO Anatomical Therapeutic Chemical classification. */
  atcCode: string | null;
  /** GTIN/EAN barcode. */
  gtin: string | null;
  edaRegNo: string | null;
  requiresPrescription: boolean;
  isControlled: boolean;
  isColdChain: boolean;
  shelfLifeMonths: number;
  isActive: boolean;
}

export interface Batch {
  id: string;
  tenantId: string;
  productId: string;
  lotNumber: string;
  mfgDate: string;
  expiryDate: string;
  unitCost: Minor;
  status: BatchStatus;
  supplierName: string | null;
}

export interface StockBalance {
  locationId: string;
  productId: string;
  batchId: string;
  qtyOnHand: number;
  qtyReserved: number;
}

export type RequisitionStopState = RequisitionStatus;

export interface Requisition {
  id: string;
  tenantId: string;
  number: string;
  requestingFacilityId: string;
  status: RequisitionStatus;
  priority: number;
  neededBy: string | null;
  notes: string | null;
  totalValue: Minor;
  createdAt: string;
}

export interface RequisitionLine {
  id: string;
  requisitionId: string;
  productId: string;
  qtyRequested: number;
  qtyApproved: number | null;
  qtyAllocated: number;
  qtyDelivered: number;
  unitPrice: Minor;
}

export interface Trip {
  id: string;
  tenantId: string;
  vehicleId: string | null;
  driverId: string | null;
  runDate: string;
  status: 'PLANNED' | 'DISPATCHED' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELLED';
  startedAt: string | null;
  endedAt: string | null;
}

export interface Stop {
  id: string;
  tripId: string;
  requisitionId: string | null;
  facilityId: string;
  sequence: number;
  status: StopStatus;
  eta: string | null;
  arrivedAt: string | null;
  deliveredAt: string | null;
  failureReason: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface ProofOfDelivery {
  id: string;
  stopId: string;
  recipientName: string;
  /**
   * Base64 signature image. Kept inline rather than in Storage because it is
   * small, immutable once written, and is evidence: co-locating it with the
   * delivery record means it cannot be orphaned.
   */
  signatureData: string | null;
  photoUrl: string | null;
  signedAt: string;
  deviceId: string | null;
  /**
   * Declared meaning of the signature, e.g. "received in good condition".
   * 21 CFR Part 11 / GDP e-signature practice: a signature without a stated
   * meaning is not evidence of anything specific.
   */
  meaning: string | null;
}

export interface AlertEvent {
  id: string;
  tenantId: string;
  type: AlertType;
  severity: AlertSeverity;
  entityType: string;
  entityId: string | null;
  message: string;
  status: 'OPEN' | 'ACK' | 'RESOLVED' | 'SNOOZED';
  createdAt: string;
  acknowledgedBy: string | null;
}

export interface AuditLogEntry {
  id: number;
  actorUserId: string | null;
  actorLabel: string | null;
  actorRole: AppRole | null;
  action: string;
  entityType: string;
  entityId: string | null;
  occurredAt: string;
}
