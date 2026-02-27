# Overwatch — Project Documentation

Overwatch is a doctrine-aligned military scenario generation and simulation platform. It produces realistic multi-domain operational scenarios — from strategic policy documents down to individual mission waypoints — using AI-driven content generation grounded in real-world military planning processes.

## Documentation Index

| Document | Description |
|---|---|
| [Architecture](./architecture.md) | System architecture, monorepo structure, tech stack |
| [Doctrine Cascade](./doctrine-cascade.md) | Strategic context generation: NDS → NMS → JSCP → CONPLAN → OPLAN |
| [Scenario Pipeline](./scenario-pipeline.md) | The 9-step `generateFullScenario` pipeline |
| [AI Functions Reference](./ai-functions.md) | Every AI-powered function, prompts, fallbacks, and model selection |
| [Daily Tasking Cycle](./daily-tasking.md) | ATO/MTO/STO generation with MAAP guidance and context chaining |
| [Game Master](./game-master.md) | AI Game Master: on-demand ATO, inject, BDA, and MAAP generation |
| [Data Model](./data-model.md) | Prisma schema — all models, relationships, and enums |
| [Simulation Engine](./simulation-engine.md) | Real-time simulation, position updates, and event injection |
| [Space Operations](./space-operations.md) | Space resource allocation, coverage computation, orbital propagation |
| [Frontend](./frontend.md) | React client — all 10 pages, Zustand store, WebSocket integration |
| [API Reference](./api-reference.md) | REST endpoints and WebSocket events |
| [Roadmap](./roadmap.md) | Phase D & E implementation roadmap |

## Quick Start

```bash
# Install dependencies
npm install

# Set up database
cd server && npx prisma db push

# Start dev server (client + server)
npm run dev
```

## Project Status

| Phase | Description | Status |
|---|---|---|
| **Phase A** | Schema + Doctrine Cascade | ✅ Complete |
| **Phase B** | AI ORBAT + Campaign Plan | ✅ Complete |
| **Phase C** | Daily Tasking Cycle | ✅ Complete |
| **POC #1** | Raw Docs → Knowledge Graph → Wargame | ✅ ~80% Complete |
| **Phase D** | Adversary Modeling & Red Force Autonomy | ⏳ Pending |
| **Phase E** | Multi-User Collaborative Wargaming | ⏳ Pending |
