'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Look a medicine up in the Egyptian drug register, instead of typing it all in.
 *
 * ── what this does and does not do ────────────────────────────────────────────────
 *
 * It fills the form. It does not save anything. The save is the button at the bottom of
 * the form, going through the same `api.create_product` as a hand-typed product, so
 * everything that validates a product still validates this one.
 *
 * That separation is the whole design. The register holds ~25,000 products and a pharmacy
 * orders a few hundred, so importing the register would make every catalogue screen read
 * a table it does not need. Searching it and saving one row at a time means the database
 * holds what the business actually stocks, and the worst a wrong suggestion can do is
 * pre-fill a field somebody then corrects.
 *
 * ── why it fills fields rather than posting ────────────────────────────────────────
 *
 * It could save directly, and that would be one click fewer. But then a mistyped query
 * becomes a saved product with no second look, and the person who has to fix it is no
 * longer looking at the screen. Pre-filling keeps a human between the suggestion and the
 * record, which is where they are useful.
 */

/** One row of the register, in the shape the route returns. */
interface RegisterHit {
  nameEn: string;
  nameAr: string;
  generic: string;
  manufacturer: string;
  drugClass: string;
  route: string;
  priceEgp: number | null;
}

export function RegisterLookup({
  labels,
}: {
  labels: {
    title: string;
    placeholder: string;
    searching: string;
    noResults: string;
    use: string;
    provenance: string;
  };
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<RegisterHit[]>([]);
  const [state, setState] = useState<'idle' | 'searching' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  // Guards against a slow response for an old query overwriting the results for the one
  // the user is actually looking at. Debouncing hides the symptom; this removes the race.
  const requestId = useRef(0);
  // The search box itself, used to find the form it belongs to when filling fields.
  const searchRef = useRef<HTMLInputElement | null>(null);

  // A one-character query matches a quarter of the register and tells the user nothing,
  // so it is not searched. Derived rather than handled inside the effect: assigning state
  // synchronously there cascades a render on every keystroke, and "the box is empty" is a
  // fact about the current input, not something an effect should report back.
  const tooShort = query.trim().length < 2;

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    // 300 ms. Long enough that typing "بروفين" does not fire six requests, short enough
    // that it still feels like typing rather than submitting.
    const timer = setTimeout(async () => {
      const id = ++requestId.current;
      setState('searching');
      setError(null);
      try {
        const res = await fetch(`/api/drug-register?q=${encodeURIComponent(trimmed)}`);
        if (id !== requestId.current) return;
        if (!res.ok) throw new Error(`search failed (${res.status})`);
        const body = (await res.json()) as { results: RegisterHit[] };
        setHits(body.results ?? []);
        setState('done');
      } catch (cause) {
        if (id !== requestId.current) return;
        setError(cause instanceof Error ? cause.message : 'search unavailable');
        setHits([]);
        setState('done');
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  // Stale results must not survive a query that is too short to search -- otherwise
  // deleting the box down to one character leaves yesterday's suggestions sitting there
  // under a query they do not answer.
  const visibleHits = tooShort ? [] : hits;

  /** Copy a suggestion into the form. Nothing is submitted. */
  function apply(hit: RegisterHit) {
    // The fields are uncontrolled -- they carry `defaultValue` and a `name` -- so the form
    // reads whatever is in the DOM at submit. Setting `.value` is therefore both necessary
    // and sufficient, and dispatching an `input` event keeps React's own state in step for
    // anything that is watching.
    // Scoped to *this* form, not the document. The catalogue page renders an edit form
    // per existing product, and those inputs carry the same `name` attributes -- so a
    // document-wide querySelector for `nameEn` fills the first product row's edit form
    // instead of the new-product form. The result looked plausible in the DOM and was
    // quietly writing into the wrong record.
    const form = searchRef.current?.closest('form');
    const set = (name: string, value: string) => {
      const el = form?.querySelector<HTMLInputElement>(`[name="${name}"]`);
      if (!el || !value) return;
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };

    set('nameEn', hit.nameEn);
    set('nameAr', hit.nameAr);
    set('genericNameEn', hit.generic);
    if (hit.route) set('form', hit.route);

    // The register's price is Egyptian retail pharmacy price, and this form's `sellPrice`
    // is in the same currency -- so it is copied as-is rather than converted or guessed.
    if (hit.priceEgp) set('sellPrice', String(hit.priceEgp));

    setHits([]);
    setQuery('');
    setState('idle');

    // Focus the first field that was filled, so the keyboard continues from where the
    // suggestion landed rather than from the top of the form.
    form?.querySelector<HTMLInputElement>('[name="nameEn"]')?.focus();
  }

  return (
    <div className="rounded-lg border border-dashed p-3">
      <label className="block text-sm font-medium" htmlFor="register-search">
        {labels.title}
      </label>
      <input
        id="register-search"
        ref={searchRef}
        data-testid="register-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={labels.placeholder}
        autoComplete="off"
        className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
      />

      {error && <p className="mt-2 text-xs text-[color:var(--color-warn)]">{error}</p>}
      {!tooShort && state === 'searching' && (
        <p className="mt-2 text-xs text-[color:var(--text-muted)]">{labels.searching}</p>
      )}

      {!tooShort && state === 'done' && hits.length === 0 && !error && (
        <p className="mt-2 text-xs text-[color:var(--text-muted)]">{labels.noResults}</p>
      )}

      {!tooShort && hits.length > 0 && (
        <>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {visibleHits.map((hit) => (
              <li key={`${hit.nameEn}-${hit.manufacturer}`}>
                <button
                  type="button"
                  data-testid="register-result"
                  onClick={() => apply(hit)}
                  className="w-full rounded-lg border p-2 text-start text-sm hover:bg-[color:var(--surface-2)]"
                >
                  <span className="block font-medium">{hit.nameAr}</span>
                  <span className="block text-xs text-[color:var(--text-muted)]">
                    {hit.nameEn}
                    {hit.generic ? ` · ${hit.generic}` : ''}
                    {hit.manufacturer ? ` · ${hit.manufacturer}` : ''}
                    {hit.priceEgp ? ` · EGP ${hit.priceEgp}` : ''}
                  </span>
                  <span className="mt-1 block text-xs text-[color:var(--text-muted)]">
                    {labels.use}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {/* Said where the suggestion came from, because a name copied out of an
              unofficial compilation is not the same claim as one from the authority. */}
          <p className="mt-2 text-xs text-[color:var(--text-muted)]">{labels.provenance}</p>
        </>
      )}
    </div>
  );
}