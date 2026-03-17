# Vibe Plant Platform Guidelines

## Mission
Build and evolve a production-ready plant management and automation platform using a React frontend, NestJS backend, and SQLite-compatible MySQL strategy.

## Execution Style
- Operate with high autonomy and continuous iteration.
- Prefer making progress without blocking on minor ambiguity.
- Keep a visible task list and always move the next highest-impact task forward.
- Iterate in loops: plan, implement, validate, fix, repeat.

## Technical Direction
- Frontend: React, TypeScript, modern component architecture, responsive dark-first UI.
- Backend: NestJS, modular domain design, strong validation, API documentation.
- Data: Start with SQLite for local speed; design schema and repository layer to swap to MySQL in production.
- Real-time: Use WebSocket or server-sent updates for live sensor and automation state.
- Hardware integration: Provide no-code setup flows for serial, local network, and Bluetooth-capable devices.

## Quality Gates
- Every meaningful feature should include tests where practical.
- Run linting, type checks, and tests before closing a major task.
- Keep architecture documentation updated as decisions evolve.
- Prioritize reliability and observability for automation features.

## Product Principles
- Plant care must be understandable at a glance.
- Automation actions must be traceable and reversible.
- Users should be able to start simple and grow into advanced automation.
- Accessibility and mobile responsiveness are required.

## Agent Collaboration
- Use specialized agents for architecture, frontend, backend, data, IoT, QA, DevOps, and docs.
- Planner agent owns sequencing and acceptance decisions.
- Specialists should return explicit outputs, risks, and next actions.