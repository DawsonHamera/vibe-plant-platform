# Vibe Plant Platform Planner Brief

## Objective
Build a complete, production-ready plant management and automation platform with high autonomy and continuous iteration.

## Required Stack
- Frontend: React plus TypeScript.
- Backend: NestJS plus TypeScript.
- Data: SQLite in local development with schema and repository strategy compatible with MySQL migration.
- Real-time: WebSocket or SSE for sensor and automation updates.

## Product Vision
The platform should let a user manage many houseplants with a polished, modern, dark-first interface and highly customizable workflows. It should evolve from manual care support into near-automatic plant care through sensor ingestion and actuator control.

## Core Features
- Plant management:
  - Add, edit, archive, and view plants.
  - Track species, nickname, room or zone, growth stage, notes, and tags.
  - Add custom image or icon per plant.
- Care planning:
  - Watering schedules with reminders, exceptions, and skipped-day handling.
  - Optional fertilizing and pruning schedules.
- Daily operations dashboard:
  - End-of-day summary with due actions, overdue plants, and health alerts.
  - Quick action controls and completion tracking.
- Real-time monitoring:
  - Live moisture, light, and temperature streams.
  - Recent trend charts and anomaly highlights.

## Hardware and Automation Requirements
Provide no-code in-app setup for sensor and actuator systems.

Supported connection pathways:
- Arduino via serial COM.
- Raspberry Pi via local network APIs or agent service.
- Optional Bluetooth-capable devices.

No-code device onboarding goals:
- Discover connection options in-app.
- Test connectivity without writing code.
- Map detected sensor channels to plants or zones.
- Calibrate sensor ranges and thresholds.
- Bind actuator outputs such as pump and mister controls.
- Validate a dry-run automation cycle before enabling live actions.

Automation system goals:
- Rules engine with simple and advanced modes.
- Safety controls including cooldowns, daily max runtime, and manual override.
- Event timeline with full traceability of why an automation ran.

## Additional Features To Include
- Room and zone layout model for grouped care.
- Plant health scoring with explainable factors.
- Notification center for alerts, reminders, and automation outcomes.
- Activity timeline and audit logs.
- Template library for common care routines.
- Simulation mode for testing automations without hardware.
- Import and export of configuration and care history.
- Role-ready architecture so multi-user auth can be added without major rewrites.

## Engineering Standards
- Domain-driven modular backend design.
- Strict DTO validation and typed API contracts.
- Repository abstraction to keep DB portability.
- Error boundaries and resilient UI states.
- Background task architecture for schedules and automation evaluation.
- Structured logging and basic metrics.

## Quality Gates
- Unit tests for key business logic.
- Integration tests for API and automation paths.
- End-to-end checks for critical UI flows.
- Lint and type checks enforced in local workflow and CI.

## Non-Functional Requirements
- Responsive on desktop and mobile.
- Accessible interactions and readable visual hierarchy.
- Fast initial load and smooth real-time updates.
- Production-minded project structure and documentation.

## Agent Workflow Expectations
- Planner continuously iterates without waiting on low-risk ambiguities.
- Specialists return explicit outputs, risks, and next actions.
- Planner integrates, validates, and decides the next highest-impact step.
- Keep working in loops until the product is fully complete and release-ready.

## Execution Cadence (Fast Autonomous Mode)
- Prefer multi-cycle runs by default: complete 2-4 implementation cycles before asking for input.
- Only pause early for hard blockers, destructive decisions, or missing external credentials/hardware.
- Use parallel specialist delegation whenever changes are in non-overlapping files.
- Favor practical completion over perfection for personal-project velocity.
- Run compact validations on changed areas each cycle; run full validation at major milestones.

## Start Command Contract
When asked to start:
- Build a milestone plan.
- Execute implementation in batches.
- Run validation after every meaningful batch.
- Keep iterating until all quality and feature goals are met.
- Default to several cycles per run before pausing for user input.

## Parallel Next Actions
- Add API docs examples for `GET /telemetry/latest` and `POST /telemetry/ingest` request/response shapes.
- Create backend tests for `GET /telemetry/latest` covering all-plants, single-plant, and missing-data cases.
- Implement frontend telemetry snapshot fetch on load before WebSocket stream attaches.
- Add dashboard UI fallback states for `null` or missing latest telemetry.
- Add structured logs/metrics around telemetry ingest volume and latest-cache hit rate.
- Draft migration notes for moving telemetry state from in-memory cache to durable storage.
