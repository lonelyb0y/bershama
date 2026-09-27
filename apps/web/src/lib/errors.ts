/**
 * Database error codes -> localised messages.
 *
 * The database raises a stable error CODE as the message, with parameters in
 * `detail` as JSON:
 *
 *   raise exception using errcode = 'P0001',
 *                         message  = 'insufficient_stock',
 *                         detail   = json_build_object('available', 12, 'requested', 40);
 *
 * That contract exists so this file can exist. An English sentence baked into a
 * `raise` cannot be translated, and recovering a number by parsing prose is how a
 * bilingual UI ends up showing the wrong number to a pharmacist.
 *
 * Two failure modes this file is written to avoid:
 *
 *   1. Showing a raw code. "insufficient_stock" in the UI is not an error message,
 *      it is a leak of the implementation. Anything unmapped falls back to a
 *      generic message, and the code is logged rather than displayed.
 *
 *   2. Showing an error with no way forward. A message a user cannot act on is
 *      noise, so where the code implies an action the message says what to do.
 */

import type { Locale } from '@/i18n/routing';

/**
 * Structured detail from a raised error.
 *
 * `detail` arrives from PostgREST as a JSON-encoded *string* containing JSON, not
 * as a parsed object, so the parse has to be attempted and tolerated. An object is
 * accepted too, because a future PostgREST version may change that.
 */
export type ErrorDetail = Record<string, string | number | boolean | null>;

/** The shape of a Postgres error as it arrives from supabase-js. */
export interface DbError {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * Error codes the database raises deliberately. This list is the contract: adding a
 * code without adding a message here means the user sees the generic fallback, so
 * `knownCodes` below is what makes that visible in a test rather than in the wild.
 */
const MESSAGES = {
  // stock and movements
  insufficient_stock: {
    en: ({ available, requested }: ErrorDetail) =>
      `Only ${available} in stock here; you asked for ${requested}. Receive more stock or reduce the quantity.`,
    ar: ({ available, requested }: ErrorDetail) =>
      `المتوفر ${available} فقط في هذا الموقع، وطلبت ${requested}. استلم كميات إضافية أو قلل الكمية.`,
  },
  location_not_found: {
    en: () => 'That storage location no longer exists, or is not available to you.',
    ar: () => 'هذا الموقع التخزيني غير موجود أو غير متاح لك.',
  },
  batch_not_found: {
    en: () => 'That batch no longer exists.',
    ar: () => 'هذه التشغيلة غير موجودة.',
  },
  batch_product_mismatch: {
    en: () => 'That batch belongs to a different product.',
    ar: () => 'هذه التشغيلة تخص منتجاً آخر.',
  },
  batch_not_released: {
    en: ({ status }: ErrorDetail) =>
      `This batch is ${String(status).toLowerCase()} and cannot be issued from. Release it first if it has been inspected.`,
    ar: ({ status }: ErrorDetail) =>
      `هذه التشغيلة ${String(status).toLowerCase()} ولا يمكن الصرف منها. يجب إطلاقها أولاً بعد الفحص.`,
  },
  batch_expired: {
    en: ({ expiry_date }: ErrorDetail) =>
      `This batch expired on ${expiry_date}. It can be written off but not issued.`,
    ar: ({ expiry_date }: ErrorDetail) =>
      `انتهت صلاحية هذه التشغيلة في ${expiry_date}. يمكن إتلافها ولكن لا يمكن صرفها.`,
  },
  quantity_must_be_positive: {
    en: ({ qty }: ErrorDetail) => `Enter a quantity greater than zero (you entered ${qty}).`,
    ar: ({ qty }: ErrorDetail) => `أدخل كمية أكبر من صفر (أدخلت ${qty}).`,
  },
  zero_quantity_movement: {
    en: () => 'A movement of zero changes nothing, so it is not recorded.',
    ar: () => 'الحركة بقيمة صفر لا تغيّر شيئاً، لذلك لم يتم تسجيلها.',
  },
  same_location_transfer: {
    en: () => 'Source and destination are the same location.',
    ar: () => 'موقع المصدر والوجهة هما نفس الموقع.',
  },

  // batches
  duplicate_lot_number: {
    en: ({ lot_number }: ErrorDetail) =>
      `Lot ${lot_number} already exists for this product.`,
    ar: ({ lot_number }: ErrorDetail) =>
      `رقم التشغيلة ${lot_number} موجود بالفعل لهذا المنتج.`,
  },
  invalid_expiry_date: {
    en: ({ mfg_date, expiry_date }: ErrorDetail) =>
      `Expiry (${expiry_date}) must be after the manufacture date (${mfg_date}).`,
    ar: ({ mfg_date, expiry_date }: ErrorDetail) =>
      `تاريخ الانتهاء (${expiry_date}) يجب أن يكون بعد تاريخ التصنيع (${mfg_date}).`,
  },
  shelf_life_implausible: {
    en: ({ actual_days, min_days, max_days }: ErrorDetail) =>
      `That expiry implies ${actual_days} days of shelf life, which is far from this product's expected ${min_days}–${max_days} days. Check the manufacture date.`,
    ar: ({ actual_days, min_days, max_days }: ErrorDetail) =>
      `تاريخ الانتهاء هذا يعني ${actual_days} يوماً من مدة الصلاحية، وهو مختلف كثيراً عن المتوقع ${min_days}–${max_days} يوماً لهذا المنتج. راجع تاريخ التصنيع.`,
  },
  lot_number_required: {
    en: () => 'Enter the lot number printed on the carton.',
    ar: () => 'أدخل رقم التشغيلة المدوّن على الكرتونة.',
  },
  illegal_batch_transition: {
    en: ({ from, to }: ErrorDetail) =>
      `A batch cannot go from ${from} to ${to}.`,
    ar: ({ from, to }: ErrorDetail) =>
      `لا يمكن تحويل التشغيلة من ${from} إلى ${to}.`,
  },
  cannot_release_expired_batch: {
    en: ({ expiry_date }: ErrorDetail) =>
      `This batch expired on ${expiry_date}, so it cannot be released. Write it off instead.`,
    ar: ({ expiry_date }: ErrorDetail) =>
      `انتهت صلاحية هذه التشغيلة في ${expiry_date}، لذلك لا يمكن إطلاقها. يجب إتلافها بدلاً من ذلك.`,
  },
  recall_reason_required: {
    en: () => 'A recall needs a reason. It becomes part of the permanent record.',
    ar: () => 'يستلزم الاستدعاء ذكر سبب، فهو جزء من السجل الدائم.',
  },
  quarantine_reason_required: {
    en: () => 'Quarantining a batch needs a reason.',
    ar: () => 'يتطلب حجر التشغيلة ذكر سبب.',
  },
  no_quarantine_location: {
    en: () => 'This organisation has no quarantine location. Create one before receiving stock.',
    ar: () => 'لا يوجد موقع حجر في هذه الجهة. أنشئ موقع حجر قبل استلام البضاعة.',
  },

  // corrections
  reason_code_required: {
    en: () => 'Choose a reason. An unexplained difference in stock is not a correction.',
    ar: () => 'اختر سبباً. الفرق غير المبرر في المخزون ليس تصحيحاً.',
  },

  // authorisation
  insufficient_role: {
    en: ({ required, action }: ErrorDetail) =>
      `Your role cannot ${action}. This needs ${required}.`,
    ar: ({ required, action }: ErrorDetail) =>
      `صلاحيتك لا تسمح بـ ${action}. يتطلب ذلك ${required}.`,
  },
  not_authenticated: {
    en: () => 'Your session has ended. Sign in again.',
    ar: () => 'انتهت جلستك. يرجى تسجيل الدخول مرة أخرى.',
  },
  audit_context_missing: {
    en: () => 'This operation needs a signed-in user. It cannot run as a background job.',
    ar: () => 'هذه العملية تتطلب مستخدماً مسجلاً، ولا يمكن تنفيذها كمهمة خلفية.',
  },
} as const;

export type ErrorCode = keyof typeof MESSAGES;

/**
 * Every code the database raises deliberately, for the test that keeps this file
 * in step with the migrations. A code added to a migration without a message here
 * would show the user a generic fallback, and that is a bug worth failing on
 * rather than discovering in Arabic.
 */
export const knownCodes: readonly string[] = [
  'insufficient_stock',
  'location_not_found',
  'batch_not_found',
  'batch_product_mismatch',
  'batch_not_released',
  'batch_expired',
  'quantity_must_be_positive',
  'zero_quantity_movement',
  'same_location_transfer',
  'duplicate_lot_number',
  'invalid_expiry_date',
  'shelf_life_implausible',
  'lot_number_required',
  'illegal_batch_transition',
  'cannot_release_expired_batch',
  'recall_reason_required',
  'quarantine_reason_required',
  'no_quarantine_location',
  'reason_code_required',
  'insufficient_role',
  'not_authenticated',
  'audit_context_missing',
];

/** Parse the `detail` field, which arrives as a JSON string inside a JSON string. */
function parseDetail(details: string | null | undefined): ErrorDetail {
  if (!details) return {};

  // PostgREST gives `detail` as a string containing JSON. Some paths hand back an
  // already-parsed object, so both are accepted rather than assuming one.
  for (const candidate of [details, safeParse(details)]) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      return candidate as ErrorDetail;
    }
  }

  return {};
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export interface LocalisedError {
  /** Ready to render, in the active locale. */
  message: string;
  /** The code, for logging and for the `data-code` attribute in the DOM. */
  code: string;
  /** True when the code was not recognised, i.e. a generic fallback was used. */
  isFallback: boolean;
}

const GENERIC = {
  en: 'Something went wrong. Try again, and tell an administrator if it keeps happening.',
  ar: 'حدث خطأ ما. حاول مرة أخرى، وأبلغ المسؤول إذا تكرر الأمر.',
};

/**
 * Turn a database error into something a person can read and act on.
 *
 * Unknown codes deliberately get a generic message rather than the raw code. A
 * missing mapping is a bug, and hiding it behind "insufficient_stok" makes the bug
 * look like a user error. The code is still returned for logging.
 */
export function localiseDbError(
  error: DbError | null | undefined,
  locale: Locale,
): LocalisedError | null {
  if (!error) return null;

  const detail = parseDetail(error.details);
  // Narrowed into a const so the successful path can use it: the `if (!entry)`
  // below proves the code is one of ours, but the compiler cannot infer that
  // through a keyed lookup, so it still sees `error.code` as possibly undefined.
  const code = error.code as ErrorCode;
  const entry = MESSAGES[code];

  if (!entry) {
    return {
      message: locale === 'ar' ? GENERIC.ar : GENERIC.en,
      code: error.code ?? 'unknown',
      isFallback: true,
    };
  }

  return {
    message: entry[locale](detail),
    code,
    isFallback: false,
  };
}

/**
 * A short, stable reason code for the movement form's dropdown.
 *
 * These are the values passed to the database as `reason_code`. They are codes and
 * not prose for a counting reason: "typo" arrives eleven different ways, and the
 * review that matters is "how many adjustments were for damage".
 */
export const REASON_CODES = {
  DAMAGE: {
    en: 'Damaged in handling',
    ar: 'تلف أثناء المناولة',
  },
  THEFT: {
    en: 'Missing / suspected theft',
    ar: 'مفقود / اشتباه في سرقة',
  },
  MISCOUNT: {
    en: 'Miscount corrected',
    ar: 'تصحيح خطأ في الجرد',
  },
  EXPIRED_WRITE_OFF: {
    en: 'Expired — written off',
    ar: 'انتهت الصلاحية — تم الإتلاف',
  },
  DAMAGE_WRITE_OFF: {
    en: 'Damaged — written off',
    ar: 'تلف — تم الإتلاف',
  },
  RETURN_SUPPLIER: {
    en: 'Returned to supplier',
    ar: 'إعادة إلى المورد',
  },
  OTHER: {
    en: 'Other (explain in the note)',
    ar: 'أخرى (اشرح في الملاحظات)',
  },
} as const;

export type ReasonCode = keyof typeof REASON_CODES;

/** Reason codes offered when adjusting stock. */
export const ADJUSTMENT_REASONS: readonly ReasonCode[] = [
  'DAMAGE',
  'MISCOUNT',
  'THEFT',
];

/** Reason codes offered when writing stock off. */
export const WRITE_OFF_REASONS: readonly ReasonCode[] = [
  'EXPIRED_WRITE_OFF',
  'DAMAGE_WRITE_OFF',
  'RETURN_SUPPLIER',
  'OTHER',
];

export function reasonLabel(
  code: ReasonCode,
  locale: Locale,
): string {
  return REASON_CODES[code][locale];
}
