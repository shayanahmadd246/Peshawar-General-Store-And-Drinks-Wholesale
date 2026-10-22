# PRD Gap Analysis — Wholesale Market Platform

## 1. Executive Summary
This document provides a systematic gap analysis comparing product requirements specified in Wholesale_Market_PRD_v2_Complete_FOR_CODEX.md (PRD v2.0) against the current codebase.

---

## 2. Requirements vs. Current Implementation Matrix

| ID | Feature / Requirement | PRD v2.0 Specification | Current Implementation Status | Gap & Risk Level |
|---|---|---|---|---|
| **AT-01** | Admin Wholesaler Lifecycle | Create, invite, suspend wholesalers; suspended accounts cannot operate. | Status field exists, but login/catalog suspension checks are incomplete. | **Medium** |
| **AT-02** | Wholesaler Tenant Isolation | Wholesaler A cannot read/update Wholesaler B records. | Shared in-memory tables; middleware scoping is rudimentary. | **High** |
| **AT-03** | Client Data Isolation | Client A cannot view Client B history. | Client state filters orders, but chat/voice assets are unauthenticated. | **Medium** |
| **AT-04** | Multilingual Chat & Voice | Typed or spoken Pashto, Urdu, English; transcribe & edit. | Language selectors exist; speech recording uses mock simulation. | **High** |
| **AT-05** | Voice Synthesis (TTS) | Playable voice synthesis with text fallback. | Audio playback indicator is simulated (udioPlayable: true). | **Medium** |
| **AT-06** | Ambiguity & Catalog Search | Clarify ambiguous units and display authorized catalog items. | Search exists; unit conversion clarification is not enforced. | **Medium** |
| **AT-07** | Conversational Cart & Checkout | Cart management across turns with explicit confirmation. | Cart management exists; multi-turn cart editing needs hardening. | **Medium** |
| **AT-08** | Multi-Wholesaler Split Orders | Split cart into suborders and invoices. | Suborders exist, but invoices trigger prematurely on submission. | **Medium** |
| **AT-09** | Atomic Inventory & Reservations| Lock stock transactionally; available = on_hand − reserved. | stockReserved incremented, but concurrency locks are missing. | **High** |
| **AT-10** | Admin Dispatch & Delivery | Assign shipments and update delivery status/proof. | Shipment assignment exists; delivery role view is partial. | **Medium** |
| **AT-11** | Partial Payment & Invoicing | Record partial payments with proper invoice allocations. | Payment recording exists; partial payment allocation needs work. | **Medium** |
| **AT-12** | Connectivity & Idempotency | Idempotency keys to prevent duplicate orders. | Idempotency keys outlined in PRD data model but absent in API. | **High** |
| **AT-13** | Prompt Injection Defense | Deny prompt injection for costs/unauthorized payments. | LLM calls rely on basic prompts without robust guardrails. | **High** |
| **AT-14** | End-to-End Demo Journey | Full shopkeeper to payment lifecycle with seed data. | Seed data exists; full flow has minor state sync gaps. | **Low** |


---

## 3. Identified Gaps & Vulnerabilities

### A. Security & Tenant Isolation
- **Tenant Scope Enforcement**: server.ts handles requests without strict tenant header verification (X-Wholesaler-Id or JWT claims). Wholesaler endpoints must verify that the authenticated user owns the tenant.
- **Prompt Injection & Data Leaks**: AI tool handlers return product costs and margins if queried directly via prompt injection. System prompts must explicitly redact cost prices from client-facing AI tool outputs.

### B. Inventory & Transaction Integrity
- **Negative Stock & Race Conditions**: Stock reservations lack atomic transaction locking. Simultaneous checkouts can result in overselling (stockOnHand < stockReserved).
- **Invoice Trigger Timing**: Invoices are currently generated upon order submission (server.ts), violating PRD Section 13 (invoices must trigger upon fulfillment/delivery, not draft submission).

### C. Voice & Multilingual Experience
- **Web Speech Integration**: Audio recording uses a timer simulation instead of browser MediaRecorder API and @google/genai audio processing.
- **TTS/STT Fallbacks**: Missing robust error handling when speech synthesis fails or network disconnects.

---

## 4. Prioritized Remediation Roadmap
1. **Phase 1: Architecture & Security Hardening** — Establish strict tenant boundaries, idempotency keys, and atomic inventory locks.
2. **Phase 2: Commerce & Inventory Integrity** — Fix invoice triggers (fulfillment-based), atomic stock reservations, and cancellation releases.
3. **Phase 3: AI & Multilingual Voice** — Integrate real Web Speech API / Gemini audio streaming for Pashto, Urdu, and English.
4. **Phase 4: End-to-End Verification** — Validate acceptance tests AT-01 through AT-14 with automated test fixtures.



---

## 5. Phase 1 Addition (Persistence & Security Requirements)

The following gaps are now prioritized under the revised Phase 1:

| ID | Requirement | Gap | Remediation Strategy |
|---|---|---|---|
| **P1-A** | PostgreSQL Persistence | Missing relational schema, Drizzle ORM, and migrations. | Replace in-memory storage with Drizzle-managed PostgreSQL. |
| **P1-B** | Secure Auth / RBAC | Hardcoded secrets; no hashing; insecure client login. | Implement bcrypt password hashing, session management, and RBAC middleware. |
| **P1-C** | Atomic Stock Operations | Non-transactional inventory management. | Use SQL UPDATE with WHERE clauses for atomic reservations. |
| **P1-D** | Idempotency | No idempotency tracking for order submission. | Enforce client-provided Idempotency-Key headers on all write operations. |

