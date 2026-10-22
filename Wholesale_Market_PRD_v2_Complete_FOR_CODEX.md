# Wholesale Market Management — Multi-Agent AI Ordering Platform

> Faithful text extraction from PRD v2.0 (21 October 2026). Page breaks indicated below.
> Tables are preserved as aligned text where possible. The PDF remains authoritative for visual layout.

## PDF Page 1

```text
WHOLESALE MARKET MANAGEMENT
MULTI-AGENT AI ORDERING PLATFORM
PRODUCT REQUIREMENTS DOCUMENT | VERSION 2.0 | 21 OCTOBER 2026

Status: Proposed final product specification • Hackathon-first delivery • Architecture handoff ready

Prepared from partner PRD v1.0, with explicitly proposed extensions for voice, multi-agent workflows, resilience
and demo scope.


1. Executive summary
Build a mobile-first B2B wholesale marketplace connecting independent wholesalers with shopkeepers (clients).
Each wholesaler owns a separate catalog, inventory, sales, costs and receivables. Shopkeepers can discover and
purchase goods from several wholesalers through normal checkout or a WhatsApp-inspired AI chat. The assistant
accepts typed messages and recorded speech, especially Pashto, Urdu and English, and responds with both
readable text and generated speech in the detected or selected language. A Super Admin oversees onboarding,
dispatch, audits and platform reporting; delivery assignees receive only relevant shipment access.

Specialized AI agents assist discovery, conversation, cart drafting, stock checking, notifications and analytics. The
server remains the source of truth: AI may propose actions but cannot bypass authorization, invent product data,
approve its own orders, or silently post money movements.


2. Scope, assumptions and priority
 Priority                               Commitment                               Delivery definition
                                                                                 Auth/roles; wholesaler product and
                                                                                 stock; client AI text +
                                                                                 Pashto/Urdu/English voice attempt; cart
 P0 / hackathon                         Working end-to-end core
                                                                                 confirmation; multi-wholesaler split;
                                                                                 approvals; admin dispatch; simple
                                                                                 payments and demo tests.
                                                                                 Spoken AI replies for supported
                                                                                 languages, persistent chat, rich UI,
 P1 / stretch                           Polished and reliable
                                                                                 receipts, notifications, basic analytics,
                                                                                 retries and local draft persistence.
                                                                                 OTP/SMS, live delivery GPS, payment
                                                                                 gateway, advanced returns, credit
 P2 / post-hackathon                    Production hardening                     policy, sophisticated risk models,
                                                                                 integrations and comprehensive
                                                                                 observability.
P0 is a minimum coherent demonstration, not permission to skip security or data integrity. Voice
recognition/synthesis quality must be tested on actual Pashto/Urdu examples before promising universal
language coverage. “Any language” is best-effort, not a guaranteed acceptance criterion.


3. Human roles and access control
 Role                                   Can do                                   Cannot do
                                        Invite/suspend wholesalers; see
                                                                                 See plaintext passwords; erase historic
 Super Admin (one designated            platform KPIs; inspect scoped records;
                                                                                 payments; make unaudited financial
 account)                               assign deliveries; view audit events;
                                                                                 corrections.
                                        handle exceptions.


                                                                         WHOLESALE MARKET | PRD v2.0 | 21 OCT 2026
```

## PDF Page 2

```text
Manage own catalog, cost, prices, stock,   See or mutate another wholesaler’s
    Wholesaler (many independent
                                           approvals, invoices, receivables and       private records; administer other
    tenants)
                                           business dashboard.                        wholesalers.
                                           Register; browse public listings; chat
                                                                                      See other clients’ private records or
    Shopkeeper / Client (many)             with AI; prepare/confirm orders; view
                                                                                      wholesalers’ internal costs/profits.
                                           own suborders, delivery and balances.
                                           View assigned shipment,
    Delivery assignee (restricted                                                     View unrelated shipments, costs,
                                           contact/delivery details; update pickup,
    operational user)                                                                 platform finances or inventories.
                                           failure and delivery proof.
A shopkeeper is a human actor. AI agents are backend services, never substitutes for authenticated human roles.
Delivery access can be a restricted mobile page rather than a fourth full dashboard in P0.


4. Core product experience

4.1 Shopkeeper: mobile-first conversational ordering
      Primary screen: WhatsApp-like conversation with message bubbles, send/record controls, recording preview,
       playback, timestamps, pending/error states, chat history and product cards.
      Language: typed or spoken Pashto, Urdu, English and mixed phrases; auto-detect with manual override;
       preserve original transcript and allow editing before order submission.
      Response: same-language text and, when synthesis succeeds, playable same-language voice. If voice fails,
       show text and an honest retry/fallback indicator; never block checkout.
      Search and comparison: only live authorized catalog results, displaying wholesaler, SKU/brand, pack size,
       unit, price, availability and minimum quantity.
      Cart: conversational add/change/remove, clarification for ambiguous quantities, packaging and supplier; one
       consolidated preview with per-wholesaler subtotals, delivery address and explicit confirmation.
      Secondary UI: conventional catalog, cart, order timeline, invoices and balance views, accessible without using
       AI.


4.2 Wholesaler operations
      Unique wholesaler tenant, private login, dashboard and product management: SKU, aliases
       (Pashto/Urdu/English), unit, pack size, cost, selling price, minimum order quantity, reorder point, stock and
       status.
      Review only relevant lines/suborders; approve/reject with reason; reserve approved quantities atomically;
       see pending, reserved, fulfilled and available quantities.
      Review own revenue, captured cost of goods sold, gross margin, receipts and customer debt; download simple
       report (P1).


4.3 Admin and delivery operations
      Admin creates/invites/suspends wholesalers; sees global order and dispatch queues, stock alerts, exceptions
       and scoped audited financial views.
      Only approved suborders can be dispatched; admin assigns a delivery assignee and records expected
       date/reference.
      Delivery assignee updates assigned status and proof; failed deliveries and returns trigger exception review,
       not silent stock or payment changes.


5. AI agent architecture: functional contract
The orchestration layer routes requests to bounded specialist agents/tools. These are logical responsibilities and
may run inside one backend process for the hackathon; they do not require six separate LLM instances.

                                                                             WHOLESALE MARKET | PRD v2.0 | 21 OCT 2026
```

## PDF Page 3

```text
Agent / service                        Responsibility                             Allowed outputs and boundaries
                                           Detect intent/language, maintain
                                                                                      Replies, tool requests; no direct
    Conversation Orchestrator              context, route tasks, ask clarifying
                                                                                      database mutation.
                                           questions.
                                           Speech-to-text, transcript editing flow,   Transcript, language, text, audio URL;
    Speech & Language Agent                multilingual response drafting, text-to-   handle unavailable synthesis
                                           speech.                                    gracefully.
                                                                                      Only products returned by authorized
                                           Resolve aliases, SKU, brand, packaging;
    Catalog Discovery Agent                                                           catalog queries; never fabricate
                                           compare available offers.
                                                                                      prices/stock.
                                           Build and modify cart, split by            Draft updates only; order creation via
    Order Draft Agent                      wholesaler, calculate preview and ask      authenticated confirmed server
                                           confirmation.                              endpoint.
                                                                                      Read-only suggestions; reservation
                                           Check stock and packaging, detect
    Inventory Validation Agent                                                        occurs transactionally in server order
                                           shortages and conflicts.
                                                                                      workflow.
                                           Summarize authorized
                                                                                      Read-only scoped aggregates; no ledger
    Business Insights Agent                wholesaler/admin sales, receivables
                                                                                      edits.
                                           and low stock.
                                                                                      Send notifications from verified
                                           Generate contextual event messages
    Workflow/Notification Agent                                                       backend events; no self-approved
                                           and recommended next actions.
                                                                                      payments/dispatch.
Trust model: model output is untrusted. Every tool receives the authenticated actor, tenant scope, schema
validation, rate limit and audit correlation ID. All monetary arithmetic, stock changes and order state transitions
are deterministic server logic.


6. Canonical business lifecycle
1.     Shopkeeper browses or chats, reviews exact products and builds a draft cart.
2.     Client confirms a final quote (products, wholesaler, unit/pack, quantity, locked unit price, subtotal, delivery).
       Server creates a parent order and per-wholesaler suborders/items using an idempotency key.
3.     Each wholesaler reviews only its own suborder lines; approval atomically reserves available stock; rejected
       items carry reasons and do not affect other wholesalers.
4.     Approved suborders enter admin dispatch queue; admin assigns a delivery assignee and tracking reference.
5.     Assignee records pickup, out-for-delivery, delivered/failed and proof; stock is consumed at the defined
       fulfillment transition; canceled reservations are released.
6.     System creates or finalizes distinct invoices per wholesaler for fulfilled items; authorized user records
       cash/bank payments with method, reference and collector; allocations reduce that wholesaler’s receivable.
7.     Return, failure or correction creates explicit reversal/credit and audit events; never rewrite prior payment
       history.

Parent order states: Draft → Submitted → In Review → Partially Approved / Approved / Rejected → Partially
Fulfilled / Fulfilled → Closed, plus Cancelled. Each suborder and shipment has its own state. Payment states are
independent: Unpaid / Partially Paid / Paid / Refunded. A rejected suborder cannot be dispatched.


7. Business rules and edge cases
      One checkout can include multiple wholesalers, but each line belongs to exactly one wholesaler; separate
       suborders, invoices, ledgers and dispatch permissions.
      At checkout, revalidate active product, current price, pack size, MOQ and delivery address; if changed,
       require renewed human confirmation.
      Quantity uses decimal-safe units; support kg, bag, carton, piece, liter and explicit pack conversions. “5 bags”
       must not be interpreted as “5 kg”; unknown bag weight requires clarification.

                                                                              WHOLESALE MARKET | PRD v2.0 | 21 OCT 2026
```

## PDF Page 4

```text
        Concurrency: lock/reserve stock in a transaction; available = on_hand − reserved; never negative. Expired or
         canceled reservations must be released exactly once.
        Retries: idempotency keys for order submission, payments, dispatch updates and stock adjustments; network
         errors must not create duplicates.
        Voice errors: unsupported codec, failed transcription, mixed languages, silence and ambiguous names
         preserve audio/transcript for retry or manual editing; no order submission from raw unreviewed transcript.
        AI conversation must not expose hidden cost, private contact records or other tenant information, including
         through prompt injection.
        If wholesaler is suspended, block new approvals and catalog sales while retaining historic records. If delivery
         fails, record a reason and require an authorized retry/return action.
        Payment: record partial/full cash or transfer; no payment is considered cleared until verified by an
         authorized collector/admin. Refunds and credits are separate auditable entries.
        Financials: gross profit = recognized net sales − captured cost of goods sold; report cash collected, sales,
         receivables and profit separately; no profit on unapproved orders.


8. Minimum data model
    Domain                                                       Core entities / fields
                                                                 users, roles, wholesaler_memberships, clients,
    Identity
                                                                 delivery_assignees, sessions; status, tenant ownership.
                                                                 wholesalers, products, product_aliases, units/packaging,
    Catalog
                                                                 price history, inventory_movements, reservations.
                                                                 carts, cart_items, orders, suborders, order_items,
    Orders
                                                                 status_events, approvals; price/cost snapshots.
                                                                 shipments, assignments, delivery_events, proof attachments
    Logistics
                                                                 and exception reasons.
                                                                 invoices, invoice_lines, payments, payment_allocations,
    Finance
                                                                 credit_notes, reversals, ledger_events.
                                                                 conversations, messages, audio_assets, transcripts,
    AI
                                                                 AI_tool_calls, AI_action_audit, language preferences.
                                                                 notifications, audit_events, idempotency_keys, retry records
    Operations
                                                                 and error events.
Database must use foreign keys, unique constraints, monetary decimal types, transaction boundaries, scoped
indexes and immutable audit/ledger entries. For P0, simplify tables only when tenant isolation and accounting
traceability remain intact.


9. Security, privacy and resilience
        Backend-enforced RBAC and tenant isolation on every endpoint, export, audio upload and AI tool. Client-
         provided wholesaler_id is never trusted as authorization.
        Password hashing, secure sessions/tokens, restricted uploads, request validation, login throttling, secure
         secrets and HTTPS in deployed environments.
        Sensitive voice files and chat transcripts have access control and a defined retention/deletion policy; never
         place API keys or private financial data in browser prompts.
        Audit who created, approved, rejected, assigned, delivered, posted, reversed or accessed sensitive cross-
         tenant data.
        Persist draft messages/cart locally where feasible; show connectivity and retry states; replay pending writes
         only with idempotency keys.
        Backups, structured errors, correlation IDs and a basic health check. For production, add automated
         recovery, monitoring, encrypted storage and disaster recovery procedures.



                                                                             WHOLESALE MARKET | PRD v2.0 | 21 OCT 2026
```

## PDF Page 5

```text
10. UX, accessibility and performance
        Mobile-first responsive experience; chat is primary for shopkeepers, operational tables and dashboards are
         optimized for desktop and mobile.
        Readable Pashto/Urdu right-to-left rendering and English left-to-right rendering, mixed-script support,
         keyboard navigation and visible labels.
        Show loading/recording/transcribing/generating/sending states; avoid blocking on TTS; provide clear fallback
         when AI unavailable.
        All displayed money in PKR; store timestamps in UTC and show Pakistan Standard Time in UI; paginate large
         lists.
        Performance targets (proposed, validate in environment): standard catalog query p95 under 2 seconds on test
         data; non-AI API actions p95 under 1 second; voice/LLM responses are asynchronous with progress and
         timeout feedback.


11. Hackathon implementation sequence
    Stage                                                      Build and demo checkpoint
                                                               Database, seed three wholesalers and shopkeepers,
    M1 — Foundation
                                                               auth/RBAC, tenant isolation, sample catalog and stock.
                                                               Client product search/cart, per-wholesaler split orders,
    M2 — Commerce
                                                               approval/rejection, reservation and status timeline.
                                                               Admin queue, assigned delivery status, one invoice per
    M3 — Dispatch + finance
                                                               wholesaler, partial payment and balances.
                                                               Chat UI, conversation persistence, catalog tools, draft
    M4 — AI text
                                                               modifications, clear confirmation gate.
                                                               Record → transcribe → editable preview → AI reply in same
    M5 — Voice
                                                               language → TTS where supported.
                                                               Run acceptance tests, fix critical issues, record a complete
    M6 — Verification + demo
                                                               multilingual multi-wholesaler journey.
Deadline guardrail: stop adding features once the end-to-end demo works. If voice output in Pashto is unreliable,
retain text and playback controls with a visible limitation; do not fabricate a successful speech demo.


12. Acceptance criteria (must test)
    ID                                                         Test / expected result
                                                               Admin creates and suspends wholesaler; old records remain;
    AT-01
                                                               suspended account cannot operate.
                                                               Wholesaler A cannot read/update wholesaler B records by
    AT-02
                                                               URL, API or AI tool.
                                                               Client A cannot view Client B order, chat, voice or payment
    AT-03
                                                               history.
                                                               Pashto, Urdu and English sample typed requests return
    AT-04
                                                               same-language text; speech input is transcribed and editable.
                                                               If same-language voice synthesis succeeds, response audio is
    AT-05
                                                               playable; if not, visible text fallback works.
                                                               Ambiguous bag/brand/size prompts clarification; AI displays
    AT-06
                                                               only live matching offers.
                                                               AI add/edit/remove cart works across turns; only explicit
    AT-07
                                                               final confirmation creates an order.
                                                               Mixed-wholesaler cart creates correct scoped suborders and
    AT-08
                                                               invoices; each owner sees only own lines.
                                                               Concurrent approvals cannot oversell; rejected/cancelled
    AT-09
                                                               lines release reservations correctly.
    AT-10                                                      Admin assigns approved shipment; delivery user accesses

                                                                           WHOLESALE MARKET | PRD v2.0 | 21 OCT 2026
```

## PDF Page 6

```text
only assigned shipment; timeline logs status.
                                                             50% verified payment leaves 50% due on the correct
    AT-11
                                                             wholesaler invoice; retry does not duplicate it.
                                                             Disconnect/retry preserves draft and does not duplicate
    AT-12
                                                             confirmed orders.
                                                             Prompt injection asking for other wholesaler costs or
    AT-13
                                                             unauthorized payment is denied.
                                                             A complete shopkeeper → wholesaler → admin → delivery →
    AT-14
                                                             payment demo can be executed with seed data.



13. Decisions to finalize before implementation
    Decision                                                 Recommended hackathon default
                                                             Zero or fixed disclosed fee; tax and discounts disabled unless
    Delivery fee / tax / discounts
                                                             explicitly configured.
                                                             Admin or authorized wholesaler manually verifies payment;
    Payment confirmation
                                                             no gateway.
                                                             Create invoice for fulfilled/delivered quantities, not merely
    Invoice trigger
                                                             submitted draft.
                                                             Before dispatch: authorized cancellation and reservation
    Cancellation / returns
                                                             release; after delivery: admin exception and credit note.
                                                             Restricted authenticated assignee view; no full independent
    Delivery role
                                                             portal needed.
                                                             Email/password or phone/password for demo; OTP as
    Client identity
                                                             production enhancement.
                                                             Select after validating real Pashto/Urdu transcription and
    Voice provider
                                                             speech synthesis on target devices.
                                                             Assist, retrieve and propose; deterministic server actions
    Scope of autonomous agents
                                                             require human confirmation/authorization.



14. Out of scope / phase 2
Direct WhatsApp integration, real-time phone calling, live GPS, fully automated payment gateway, production
SMS OTP, sophisticated fraud scoring, advanced returns/refunds, external accounting integrations, multilingual
coverage guarantees beyond tested languages, predictive procurement and multi-region deployment.


15. Architecture handoff checklist
      Confirm tech stack, deployment target and database; map RBAC and tenant boundaries.
      Draw client, wholesaler, admin and delivery interfaces and API contracts.
      Define order/suborder/line-item state machines and inventory/payment transaction boundaries.
      Choose AI model(s), speech provider, tool schemas, prompt-injection defenses, timeout/retry policies and cost
       limits.
      Prepare seeded demo products with Pashto/Urdu aliases and realistic unit/pack conversions.
      Write end-to-end test fixtures for cross-tenant denial, partial payment, voice review and idempotent
       submission.

Source alignment: Sections 1, 3, 4.2, 4.3, 6, 7, 8 and 9 retain and clarify the original v1.0 business model. Expanded
conversational UI, mandatory multilingual experience, multi-agent contracts, resilience, prioritization and
detailed edge-case acceptance tests are proposed v2.0 additions; defaults in Section 13 require stakeholder
approval.




                                                                         WHOLESALE MARKET | PRD v2.0 | 21 OCT 2026
```
