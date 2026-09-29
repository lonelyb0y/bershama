/**
 * How this project addresses the `api` schema, and why it is not `.schema()`.
 *
 * ── what does not work ──────────────────────────────────────────────────────
 *
 * The obvious way to reach a non-public schema with supabase-js is
 *
 *     supabase.schema('api').rpc('whoami')
 *
 * which issues `POST /rest/v1/api/rpc/whoami`. On this project that is a 404:
 *
 *     PGRST125  Invalid path specified in request URL
 *
 * Not just for `api` either. `/rest/v1/public/batches` is 404 as well, so
 * schema-qualified *paths* are not served at all here -- a PostgREST that cannot
 * route its own default schema by name is not selectively failing on one schema.
 *
 * ── what does work, verified against the deployed project ───────────────────
 *
 * The profile headers, which are the documented mechanism for switching schemas:
 *
 *     POST /rest/v1/rpc/whoami
 *     Accept-Profile: api
 *     Content-Profile: api
 *     -> 200 []
 *
 * Same request with the wrong arity returns PGRST202 naming `api.stock_take`,
 * which is PostgREST confirming it FOUND the function and only the arguments did
 * not match. The error moving from PGRST125 to PGRST202 is the signal that a
 * route went from non-existent to working.
 *
 * A correctly-argued call reaches the function and runs it:
 *
 *     -> 403 insufficient_role
 *        {"required": "TENANT_ADMIN or WAREHOUSE_MANAGER", "actual": null}
 *
 * which is this project's own `private.require_inventory_write()` refusing, and
 * is the correct outcome for a session with no profile.
 *
 * ── the security properties, checked not assumed ───────────────────────────
 *
 *   no JWT                    -> 401   an unauthenticated caller is refused
 *   Accept-Profile: private   -> 406   `private` is not in the served list at all
 *
 * The second one is the one that matters. It means naming `private` in a header
 * does not reach it: the schema is absent from PostgREST's served list and is
 * also absent from USAGE for every role, so the balance trigger and the single
 * writer of the ledger stay unreachable over HTTP by either route.
 *
 * ── how the client is wired ─────────────────────────────────────────────────
 *
 * The headers are set on the client itself rather than per call, so no call site
 * can forget one. `Accept-Profile` selects the schema for the response and
 * `Content-Profile` for the request body; a PostgREST call needs both, and
 * setting only one produces a confusing 406.
 */

/** The schema every privileged operation lives in. */
export const API_SCHEMA = 'api';

  /**
   * The raw profile headers that route a request to the api schema.
   *
   * KEEP THIS FOR REFERENCE AND TESTS ONLY. Do not pass it to a Supabase client as
   * `global.headers` -- that does not work, and it fails in the most confusing way
   * available.
   *
   * Measured against the hosted project, calling `api.whoami`:
   *
   *   global: { headers: { 'Accept-Profile', 'Content-Profile' } }  ->  PGRST202
   *   db: { schema: 'api' }                                          ->  200, role returned
   *   raw fetch with both headers                                    ->  200
   *
   * The cause: on a POST, supabase-js manages `Content-Profile` itself and the
   * value set through `global.headers` never reaches PostgREST. PostgREST then
   * resolves the function in the first served schema -- `public` -- and reports
   * "Could not find the function public.whoami". The same header pair sent by hand
   * works, which is what made this so hard to see: every curl check passed while
   * every browser request failed.
   *
   * `db.schema` is the option the library actually honours, because it is the one
   * it wires into both the request and response profile itself. Use
   * `getSupabaseApi` / `getSupabaseApiClient`; do not build a client by hand.
   */
  export const API_PROFILE_HEADERS = {
    'Accept-Profile': API_SCHEMA,
    'Content-Profile': API_SCHEMA,
  } as const;

  /**
   * The client option that actually routes requests to the api schema.
   *
   * This is the ONLY supported way to reach the schema from supabase-js. Not
   * `.schema('api')`, which is a 404 here, and not the header pair above, which
   * is silently dropped on POST.
   */
  export const API_DB_OPTION = { schema: API_SCHEMA } as const;

/**
 * Type of a client that talks to the api schema.
 *
 * Note there is no `schema()` method, deliberately: on this project the
 * path-based form is a 404, so a client that can address the schema that way is
 * a footgun. Removing it from the type means `.schema('api')` stops compiling
 * rather than shipping a request that 404s in production.
 */
export type ApiSchemaClient<TSupabaseClient> = Omit<TSupabaseClient, 'schema'>;
