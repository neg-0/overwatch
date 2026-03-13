# Overwatch — Project Documentation

Overwatch is an AI-powered narrative-to-structure pipeline for military operations. Its core capability is transforming arbitrary narrative data — raw documents, plans, orders, and reports — into structured findings, tasking orders (ATO/MTO/STO), and a knowledge graph that links hierarchies, assets, missions, and their interactions. Visualization layers (map, timeline, simulation) exist to display and validate the structured output.

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
| **[POC #1](./poc-1.md)** | **Knowledge Graph & Doctrine-Aligned Wargame Generation** |
| **[POC #2](./poc-2.md)** | **Space Domain AI Decision Support System** |

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
| **POC #1** | Narrative → Structured Data (findings, ATO/MTO/STO, knowledge graph) | ✅ ~80% Complete |
| **POC #2** | Space Domain AI Decision Support System | ⏳ Pending |
| **Phase D** | Adversary Modeling & Red Force Autonomy | ⏳ Pending |
| **Phase E** | Multi-User Collaborative Wargaming | ⏳ Pending |
