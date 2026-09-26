// Role-based routing. Pure, framework-free, importable from anywhere.
//
// This lives apart from session.ts on purpose. session.ts depends on
// next/headers, so importing it from a client component drags a server-only API
// into the browser bundle and fails the build. The role-to-dashboard mapping is
// needed on both sides -- the login form to route after sign-in, the server
// guard to decide which shell to render -- so it belongs in a module with no
// server dependencies at all.

import type { AppRole } from './types';

export type Surface = 'admin' | 'pharmacy' | 'distributor';

/** Which dashboard a role belongs on. */
export function homeRouteForRole(role: AppRole): string {
  switch (role) {
    case 'DISTRIBUTOR':
      return '/distributor';
    case 'PHARMACY_MANAGER':
      return '/pharmacy';
    case 'TENANT_ADMIN':
    case 'WAREHOUSE_MANAGER':
    case 'DISPATCHER':
    case 'ANALYST':
      return '/admin';
    default: {
      // Exhaustiveness guard: adding a role without deciding where it lands
      // becomes a compile error rather than a dead-end redirect at runtime.
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}

/** Roles permitted on a given surface. Used by the server route guards. */
export const ROLES_BY_SURFACE: Record<Surface, AppRole[]> = {
  admin: ['TENANT_ADMIN', 'WAREHOUSE_MANAGER', 'DISPATCHER', 'ANALYST'],
  pharmacy: ['PHARMACY_MANAGER', 'TENANT_ADMIN'],
  distributor: ['DISTRIBUTOR', 'DISPATCHER', 'TENANT_ADMIN'],
};
