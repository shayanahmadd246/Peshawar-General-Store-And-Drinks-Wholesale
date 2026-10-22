# Phase 1 Architecture — Wholesale Market Platform (Revised)

## 1. Overview
The revised Phase 1 focuses on hardening the foundation for production readiness. We are transitioning from in-memory mocks to a robust, transactional, and secure backend using PostgreSQL and Drizzle ORM, while enforcing strict RBAC and multi-tenancy.

## 2. Core Architectural Pillars
- **Persistence (PostgreSQL + Drizzle)**: Transition from in-memory objects to a normalized relational schema. Inventory and order lifecycle events (reservation, approval, dispatch, fulfillment) will use database-level ACID transactions to ensure data consistency.
- **Security & RBAC**: Centralized authentication using bcrypt/SHA-256 and JWTs for session management. Middleware will enforce 	enant_id scope on every request, preventing cross-tenant leakage.
- **Order & Inventory Integrity**: Backend-deterministic calculations for totals, MOQ, and unit conversions. Atomic SQL UPDATE statements with WHERE stock >= requested clauses for reservation.
- **Idempotency**: Strict request tracing using client-generated idempotency keys in order headers.

## 3. Revised Implementation Priorities
1. **Schema Definition**: Define Drizzle schemas for all domains (Identity, Catalog, Orders, Logistics, Finance).
2. **Persistence Layer**: Implement Drizzle ORM setup, migrations, and seed scripts.
3. **RBAC Hardening**: Rewrite authentication to use secure hashed passwords and role-based middleware.
4. **Transactional Ordering**: Implement atomic reservation patterns and fulfillment-based invoice triggers.
5. **Verification**: Execute tests for authentication, tenant isolation, and concurrency.

## 4. Constraint Compliance
- Preserve current frontend functionality and existing mahad-development branch.
- No destruction of data or invention of credentials.
- Incremental implementation, stopping before Phase 2 (AI/Voice).

