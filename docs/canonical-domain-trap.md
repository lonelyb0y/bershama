# The canonical-domain trap

**Symptom:** Google sign-in appears to do nothing. The person authenticates at
Google, comes back, and lands somewhere that is not the app — usually a Vercel
login portal, or the sign-in page again. Nothing is logged, nothing errors.

**Cause:** Supabase decides where to send someone *after* they authenticate, and
it checks that destination against `site_url` and `uri_allow_list` in the
project's auth settings. Those are two independent settings from Vercel's domains,
and they drift.

A Vercel project has more than one domain:

| domain | what it is | protected? |
|---|---|---|
| `pharmaflow-bay.vercel.app` | the alias you actually use | no |
| `pharmaflow-s1mpll3-s.vercel.app` | the project's canonical domain | **yes — Vercel SSO** |

The auth settings pointed at the canonical one, which was not in the allow list.
So GoTrue sent the user to the protected domain, where the session cookie had
never been set, and the app bounced them to `/login`. The button was never
broken; the destination was.

**Fix:** make the auth settings point at the domain people actually visit.

```
site_url        = https://pharmaflow-bay.vercel.app
uri_allow_list  = http://localhost:3000,http://localhost:3000/**,
                  https://pharmaflow-bay.vercel.app,https://pharmaflow-bay.vercel.app/**,
                  https://pharmaflow-s1mpll3-s.vercel.app,https://pharmaflow-s1mpll3-s.vercel.app/**,
                  https://pharmaflow-*-s1mpll3-s.vercel.app,https://pharmaflow-*-s1mpll3-s.vercel.app/**
```

Keep the wildcard entries. Preview deployments live at
`pharmaflow-<hash>-s1mpll3-s.vercel.app` and the browser job signs in against
those, so removing them breaks CI.

**How to check it, in one command:**

```bash
curl -s "https://api.supabase.com/v1/projects/$REF/config/auth" \
  -H "Authorization: Bearer $TOKEN" | python3 -c \
  'import sys,json; d=json.load(sys.stdin); print(d["site_url"]); print(*d["uri_allow_list"].split(","), sep="\n")'
```

Every domain people can reach the app on must be in that list, and `site_url`
must be one of them.

**And the same trap in reverse:** if the app is served on a domain that *is*
behind Vercel Deployment Protection, the session cookie is set for a host the
user never reaches. Development and preview deployments are protected by
default; production aliases are not. A preview behind the wall is a bug, and so
is a production domain behind it if the product is meant to be reachable.
