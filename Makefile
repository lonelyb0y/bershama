# ============================================================================
# PharmaFlow
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
	@echo "PharmaFlow"
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
	pnpm --filter @pharmaflow/web test

.PHONY: test-db
test-db: ## Apply migrations and run the pgTAP suites (no Docker required)
	./scripts/verify-db.sh

.PHONY: e2e
e2e: ## Run Playwright end-to-end tests (needs the app and database running)
	pnpm e2e

# ── quality ──────────────────────────────────────────────────────────────────

.PHONY: lint
lint: ## Lint the web app
	pnpm --filter @pharmaflow/web lint

.PHONY: typecheck
typecheck: ## Type-check the web app
	pnpm --filter @pharmaflow/web typecheck

.PHONY: build
build: ## Production build
	pnpm --filter @pharmaflow/web build

.PHONY: secrets
secrets: ## Fail if the Supabase secret key appears anywhere it must not
	@# A real key is sb_secret_ followed by ~20+ characters of mixed-case base64.
	# The template and the docs are excluded because .env.example has to SHOW the
	# variable shape, otherwise it is not a template. Everything else is scanned,
	# including lockfiles and generated output, because a key committed anywhere is
	# a leaked key.
	@if grep -rIn --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git \
	     --exclude=.env.local --exclude=.env --exclude=.env.example \
	     --exclude-dir=docs --exclude=README.md \
	     -E 'sb_secret_[A-Za-z0-9_-]{20,}' . 2>/dev/null; then \
		echo ""; \
		echo "FAIL: a Supabase secret key is present in the working tree."; \
		echo "Revoke it in the dashboard, rotate, then re-run."; \
		exit 1; \
	else \
		echo "No secret keys in the working tree."; \
	fi
	@# The legacy long JWT keys are deprecated end of 2026 but are still in
	@# circulation; catching one is the same emergency. Thresholds are set from
	@# real JWT structure: the header segment is typically ~36 characters
	@# ({"alg":"HS256","typ":"JWT"} base64url-encoded) and the signature is ~43, so
	@# requiring 40 would miss an ordinary key. 20 is comfortably above anything
	@# that is not a JWT and comfortably below a real one.
	@if grep -rIn --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git \
	     --exclude=.env.local --exclude=.env --exclude=.env.example \
	     --exclude-dir=docs --exclude=README.md \
	     -E 'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}' . 2>/dev/null; then \
		echo ""; \
		echo "FAIL: what looks like a Supabase legacy service_role JWT is committed."; \
		echo "Revoke it in the dashboard and rotate."; \
		exit 1; \
	fi
	@echo "No legacy service_role JWTs in the working tree."

.PHONY: assertions
assertions: ## Check the pgTAP suites are portable between pgTAP and the shim
	python3 scripts/check-assertions.py

.PHONY: check
check: lint typecheck test secrets assertions ## Fast checks, no database needed

.PHONY: verify
verify: check test-db build ## Everything CI runs
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
types: ## Regenerate TypeScript types from the database
	supabase gen types typescript --local > $(APP_DIR)/src/lib/database.types.ts

.PHONY: clean
clean: ## Remove build output
	rm -rf $(APP_DIR)/.next node_modules
