# ============================================================================
# Bershama
#
# `make help` lists every target. The ones that matter day to day:
#
#   make dev        local Supabase + web app, with seed data
#   make verify     everything CI runs, runnable without Docker
#   make test-db    migrations + pgTAP suites against a throwaway cluster
#   make db-reset   reset the local Supabase database and re-seed
#   make check      lint + typecheck + unit tests (fast, no database needed)
# ============================================================================

.DEFAULT_GOAL := help
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

# Never let a target succeed because a pipeline swallowed a failure.
MAKEFLAGS += --warn-undefined-variables

APP_DIR := apps/web
SUPABASE_DIR := supabase

# ── help ─────────────────────────────────────────────────────────────────────

.PHONY: help
help: ## Show this help
	@echo ""
	@echo "Bershama"
	@echo ""
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[1;36m%-16s\033[0m %s\n", $$1, $$2}'
	@echo ""

# ── setup ────────────────────────────────────────────────────────────────────

.PHONY: install
install: ## Install workspace dependencies
	pnpm install

.PHONY: env
env: ## Create .env.local from .env.example if missing
	@if [ -f .env.local ]; then \
		echo ".env.local already exists; leaving it alone."; \
	else \
		cp .env.example .env.local; \
		chmod 600 .env.local; \
		echo "Created .env.local (mode 600). Fill in your Supabase keys."; \
	fi

.PHONY: doctor
doctor: ## Check the local toolchain
	@echo "Node       : $$(node --version 2>/dev/null || echo MISSING)"
	@echo "pnpm       : $$(pnpm --version 2>/dev/null || echo MISSING)"
	@echo "Supabase   : $$(supabase --version 2>/dev/null || echo MISSING)"
	@echo "Docker     : $$(docker --version 2>/dev/null || echo 'MISSING (optional)')"
	@echo "Postgres   : $$(psql --version 2>/dev/null || echo 'MISSING (optional, for test:db)')"
	@echo ""
	@echo "Docker is only needed for the full local Supabase stack."
	@echo "'make test-db' and 'make verify' work without it."

# ── database ─────────────────────────────────────────────────────────────────

.PHONY: db
db: ## Start the local Supabase stack (requires Docker)
	supabase start

.PHONY: dbstop
dbstop: ## Stop the local Supabase stack
	supabase stop

.PHONY: db-reset
db-reset: ## Reset the local database and re-apply migrations + seed
	supabase db reset

.PHONY: db-diff
db-diff: ## Generate a migration from the current remote schema
	supabase db diff -f add_changes

.PHONY: db-expose-api
db-expose-api: ## Tell PostgREST to re-read its config, so the api schema is routable
	@# The dashboard's "Exposed schemas" is not always reflected in the role
	@# PostgREST actually reads, so set it here and signal both kinds of reload.
	@psql "$${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}" -qtA -c "alter role authenticator set pgrst.db_schemas = 'public, graphql_public, api';" 2>/dev/null \
	  || psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -qtA -c "alter role authenticator set pgrst.db_schemas = 'public, graphql_public, api';"
	@psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -qtA -f scripts/expose-api-schema.sql
	@echo "  api schema is now routable. Verify: curl localhost:54321/rest/v1/api/rpc/whoami"

.PHONY: config-push
config-push: ## Push config.toml to the hosted project, then repair the auth settings
	@# Two steps, in this order, and the second is not optional: `supabase config
	@# push` rewrites the auth config and drops the email provider toggle, which
	@# makes every sign-in return 422 email_provider_disabled. Do it in one target
	@# so the footgun is disarmed rather than remembered.
	@SUPABASE_YES=1 supabase config push
	@SUPABASE_PROJECT_REF=$${SUPABASE_PROJECT_REF:-} ./scripts/fix-hosted-auth.sh

.PHONY: db-push
db-push: ## Apply local migrations to the linked remote project
	@command -v supabase >/dev/null || { echo "supabase CLI not found"; exit 1; }
	@read -p "Apply supabase/migrations to the LINKED REMOTE project? [y/N] " a; \
	 [ "$$a" = "y" ] || { echo "aborted"; exit 1; }
	supabase db push

.PHONY: link
link: ## Link the repository to a Supabase project
	@read -p "Supabase project ref: " ref; \
	 supabase link --project-ref "$$ref"

# ── tests ────────────────────────────────────────────────────────────────────

.PHONY: test
test: ## Run web unit tests
	pnpm --filter @bershama/web test

.PHONY: test-db
test-db: ## Apply migrations and run the pgTAP suites (no Docker required)
	./scripts/verify-db.sh

.PHONY: e2e
e2e: ## Run Playwright end-to-end tests (starts the app itself)
	cd apps/web && npx playwright test


# ── quality ──────────────────────────────────────────────────────────────────

.PHONY: lint
lint: ## Lint the web app
	pnpm --filter @bershama/web lint

.PHONY: typecheck
typecheck: ## Type-check the web app
	pnpm --filter @bershama/web typecheck

.PHONY: build
build: ## Production build
	pnpm --filter @bershama/web build

.PHONY: secrets
secrets: ## Fail if a Supabase secret key appears in anything git would commit
	@# SCOPE: the union of tracked files and files that `git add -A` would stage.
	@#
	@# Not a filesystem walk. A walk finds every local artefact, including
	@# supabase start's generated .temp/ and a developer's .env.local backup, and
	@# flags all of them -- none of which can reach a commit because .gitignore
	@# already excludes them. A check that cries wolf gets switched off, and a
	@# switched-off secret scan is worse than none: it is false confidence.
	@#
	@# The question this answers is "could a key be committed?", and that is exactly
	@# the set above.
	@# Shell command substitution inside a Make recipe has to use backticks: a
	@# dollar-paren is a MAKE variable reference, even inside a recipe comment.
	@# Getting that wrong made this target exit 2 on a syntax error, which the
	@# leak tests initially read as "caught" -- a check that passes for the wrong
	@# reason is the same failure as no check at all.
	@set -e; \
	 { git ls-files; git ls-files --others --exclude-standard; } \
	   | sort -u > .secrets-scan-files.tmp; \
	 n=`wc -l < .secrets-scan-files.tmp | tr -d ' '`; \
	 if [ "$$n" -eq 0 ]; then rm -f .secrets-scan-files.tmp; \
	   echo "Nothing to scan; refusing to pass silently."; exit 1; fi; \
	 if xargs -a .secrets-scan-files.tmp grep -In -E 'sb_secret_[A-Za-z0-9_-]{20,}' 2>/dev/null; then \
	   echo ""; \
	   echo "FAIL: a Supabase secret key is committable."; \
	   echo "Revoke it in the dashboard, rotate, and remove it from the file."; \
	   rm -f .secrets-scan-files.tmp; exit 1; fi; \
	 echo "  no sb_secret_ keys among the $$n committable files"; \
	 if xargs -a .secrets-scan-files.tmp grep -In -E 'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}' 2>/dev/null; then \
	   echo ""; \
	   echo "FAIL: what looks like a legacy service_role JWT is committable."; \
	   echo "Revoke it in the dashboard and rotate."; \
	   rm -f .secrets-scan-files.tmp; exit 1; fi; \
	 echo "  no legacy service_role JWTs among them"; \
	 rm -f .secrets-scan-files.tmp; \
	 echo "No secret keys committable."

.PHONY: assertions
assertions: ## Check the pgTAP suites are portable between pgTAP and the shim
	python3 scripts/check-assertions.py

.PHONY: drift
drift: ## Check the client error mapper against the codes the database raises
	python3 scripts/check-error-codes.py

.PHONY: api-types
api-types: ## Check the generated TS types against the api schema
	python3 scripts/check-api-types.py

.PHONY: i18n-keys
i18n-keys: ## Check that every translation key the code asks for exists
	node scripts/check-i18n-keys.mjs

.PHONY: spacing
spacing: ## Check that every spacing value is on the 4px grid
	node scripts/check-spacing.mjs

.PHONY: hosted-check
hosted-check: ## Check the deployed project routes the api schema (needs HOSTED_* env)
	@./scripts/check-hosted-schemas.sh

.PHONY: check
check: lint typecheck test secrets assertions drift api-types i18n-keys spacing ## Fast checks, no database needed

.PHONY: verify
verify: check test-db build e2e ## Everything CI runs
	@echo ""
	@echo "All checks passed."

# ── run ──────────────────────────────────────────────────────────────────────

.PHONY: dev
dev: ## Run the web app in development mode
	pnpm dev

.PHONY: dev-web
dev-web: ## Run only the web app (database must already be running)
	pnpm dev

# ── housekeeping ─────────────────────────────────────────────────────────────

.PHONY: types
# Not `supabase gen types --project-id` directly, and not redirecting its stdout into
# database.types.ts. That needs a personal access token, tokens expire, and when one does
# the CLI writes a 153-byte JSON error document over the committed types -- after which
# check-api-types reports every api function as missing and typecheck, lint and the build
# all fail as though the schema had collapsed. scripts/gen-types.sh builds a throwaway
# cluster from the migrations (which are the source of truth), generates to a temporary
# file, verifies the output is TypeScript, and only then moves it into place.
types: ## Regenerate TypeScript types from the database
	@./scripts/gen-types.sh

.PHONY: clean
clean: ## Remove build output
	rm -rf $(APP_DIR)/.next node_modules
