import { getSupabase } from '@/lib/supabase/server';
import type { Locale } from '@/i18n/routing';
import type { AuditLogEntry } from '@/lib/types';

/**
 * Human labels for the entities an audit entry refers to.
 *
 * The audit log was showing `entry.entityId.slice(0, 8)` -- eight characters of
 * a UUID, so every row read "facilities · 11111111". A truncated identifier is
 * the worst of both worlds: it is not a name, so it tells a reader nothing, and
 * it is not a full identifier, so it cannot even be pasted into a search.
 *
 * Resolved server-side in one query per entity type rather than per row: five
 * rows that happen to touch three facilities should cost three lookups or fewer,
 * not five. N+1 here would be invisible in a demo with two rows and obvious on
 * a real tenant's log.
 *
 * RLS applies, exactly as it does to the audit rows themselves, so an entry can
 * only ever be labelled from within the caller's own tenant. A facility that
 * has been deleted resolves to nothing, and the caller sees the short id as
 * before rather than a blank.
 */
export async function labelEntities(
  entries: AuditLogEntry[],
  locale: Locale,
): Promise<Map<string, string>> {
  const supabase = await getSupabase();
  const labels = new Map<string, string>();

  // entity_type is the table name, so the two agree by construction; the map is
  // what makes that explicit rather than assumed, so a new audited type is a
  // deliberate addition instead of a silent blank.
  const resolvers: Record<
    string,
    (ids: string[]) => Promise<Array<{ id: string; label: string }>>
  > = {
    facilities: async (ids) => {
      const { data } = await supabase
        .from('facilities')
        .select('id, name_en, name_ar, code')
        .in('id', ids);
      return (data ?? []).map((f) => ({
        id: f.id,
        label: pick(f.name_ar, f.name_en, f.code, locale),
      }));
    },

    storage_locations: async (ids) => {
      const { data } = await supabase
        .from('storage_locations')
        .select('id, code, name_en, name_ar')
        .in('id', ids);
      return (data ?? []).map((l) => ({
        id: l.id,
        // A location is identified on a shelf by its code, so the code leads
        // even in Arabic: AMB-A1 is what gets written on paper.
        label: `${l.code} · ${pick(l.name_ar, l.name_en, null, locale)}`,
      }));
    },

    products: async (ids) => {
      const { data } = await supabase
        .from('products')
        .select('id, name_en, name_ar, sku')
        .in('id', ids);
      return (data ?? []).map((p) => ({
        id: p.id,
        label: pick(p.name_ar, p.name_en, p.sku, locale),
      }));
    },
  };

  // Group by type so each table is queried once with all of its ids.
  const byType = new Map<string, string[]>();
  for (const entry of entries) {
    if (!entry.entityId) continue;
    const bucket = byType.get(entry.entityType);
    if (bucket) bucket.push(entry.entityId);
    else byType.set(entry.entityType, [entry.entityId]);
  }

  await Promise.all(
    [...byType.entries()].map(async ([type, ids]) => {
      const resolve = resolvers[type];
      // Unknown type: no lookup, and the caller falls back to the short id.
      if (!resolve) return;

      try {
        for (const { id, label } of await resolve([...new Set(ids)])) {
          labels.set(`${type}:${id}`, label);
        }
      } catch {
        // A label is decoration on top of an audit row. If the lookup fails the
        // row is still correct and still shows its id, so this must not take the
        // dashboard down with it.
      }
    }),
  );

  return labels;
}

/** The first non-empty candidate, preferring the requested locale. */
function pick(
  localised: string | null | undefined,
  fallback: string | null | undefined,
  lastResort: string | null | undefined,
  locale: Locale,
): string {
  const order = locale === 'ar' ? [localised, fallback, lastResort] : [fallback, localised, lastResort];
  return order.find((v) => Boolean(v && v.trim())) ?? '';
}

/**
 * "facilities.insert" -> "Created a facility".
 *
 * An audit log is read by someone asking two questions: who did this, and what
 * did they change. A table name and a Postgres verb answer neither. The verb
 * table is short and the set of operations is fixed by what the app writes, so
 * anything unmapped falls back to the raw action rather than to nothing.
 */
const ACTION_VERBS: Record<string, string> = {
  insert: 'created',
  update: 'updated',
  delete: 'deleted',
  hard_delete: 'deleted',
  sign_in: 'signed in',
  sign_out: 'signed out',
};

type Translate = (key: string) => string;

export function translateEntityType(entityType: string, t: Translate, locale: Locale): string {
  const key = `entityTypes.${entityType}`;
  try {
    // next-intl throws on a missing key; catching is how a new audited table
    // stays visible as a raw name rather than blanking the whole log.
    return t(key) as string;
  } catch {
    return locale === 'ar' ? entityType : entityType.replace(/_/g, ' ');
  }
}

export function describeAction(action: string, t: Translate, locale: Locale): string {
  const [entity, verb] = action.split('.');
  const human = verb ? ACTION_VERBS[verb] : undefined;
  if (!verb || !human) return action;

  const noun = translateEntityType(entity, t, locale);
  return locale === 'ar' ? `${ACTION_VERBS_AR[verb] ?? verb} ${noun}` : `${human} a ${noun}`;
}

/**
 * Arabic past-tense verbs, in the masculine singular that suits a passive
 * description of an automated action ("a facility was created").
 */
const ACTION_VERBS_AR: Record<string, string> = {
  insert: 'تم إنشاء',
  update: 'تم تعديل',
  delete: 'تم حذف',
  hard_delete: 'تم حذف نهائي',
  sign_in: 'سجّل الدخول',
  sign_out: 'سجّل الخروج',
};
