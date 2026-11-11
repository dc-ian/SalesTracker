// Phase 1 — Role Matrix & Rules
// Single source of truth for what each role can do. Phase 5's auth/session
// middleware and route guards should call can(role, permission) rather than
// hardcoding role checks inline in routes.

const ROLES = Object.freeze({
  EMPLOYEE: 'employee',
  ADMIN: 'admin',
});

const PERMISSIONS = Object.freeze({
  CREATE_ORDER: [ROLES.EMPLOYEE, ROLES.ADMIN],
  VIEW_DASHBOARD: [ROLES.EMPLOYEE, ROLES.ADMIN],
  SUBMIT_FIX_REQUEST: [ROLES.EMPLOYEE],      // on locked/approved orders only
  EDIT_DELETE_ORDER: [ROLES.ADMIN],
  APPROVE_UNAPPROVE_ORDER: [ROLES.ADMIN],
  MANAGE_PRODUCTS_STORES_USERS: [ROLES.ADMIN],
  VIEW_AUDIT_LOG: [ROLES.ADMIN],
});

// OPEN QUESTION (flagged in Phase 1 review): the source plan doesn't say
// whether an Employee can edit/delete their OWN unapproved order, only that
// Admin has full edit/delete access. Resolve before Phase 5 route guards are
// written — if yes, add an EDIT_OWN_UNAPPROVED_ORDER permission here.

function can(role, permission) {
  const allowed = PERMISSIONS[permission];
  if (!allowed) {
    throw new Error(`Unknown permission: ${permission}`);
  }
  return allowed.includes(role);
}

module.exports = { ROLES, PERMISSIONS, can };
