# Overwatch

**Real-Time Multi-Domain Military Tasking Order Decision Dashboard**

Overwatch is an AI-powered narrative-to-structure intelligence pipeline and simulation dashboard for military operations. Its core capability is transforming arbitrary narrative data — such as raw documents, strategic plans, orders, and reports — into structured findings, actionable tasking orders (ATO/MTO/STO), and a comprehensive knowledge graph that links hierarchies, assets, missions, and their interdependencies. 

The system features real-time visualization layers including a map, timeline, and simulation engine to display, manipulate, and validate the parsed structured output.

## Table of Contents

- [Core Capabilities](#core-capabilities)
- [System Architecture & Tech Stack](#system-architecture--tech-stack)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [Documentation & Deep Dives](#documentation--deep-dives)
- [Project Status](#project-status)

## Core Capabilities

1. **Narrative → Structure Pipeline:** Uses AI (OpenAI GPT-5 family) to ingest raw text, classify document types, extract hierarchical relationships, and normalize the data into structured JSON matching a rigorous schema.
2. **Tasking Order Generation:** Produces Joint Integrated Prioritized Target Lists (JIPTL) and generates operational daily Air, Maritime, and Space Tasking Orders (ATO/MTO/STO).
3. **Knowledge Graph:** Builds dynamic relationships tying strategic doctrine (NDS, NMS, JSCP, CONPLAN, OPLAN) down to individual missions and target assets.
4. **Real-time Simulation & Decision Support:** An integrated Node.js+Socket.IO engine runs simulated time, propagating orbital mechanics via SGP4 and simulating Joint Force operations on an interconnected map/timeline dashboard.
5. **AI Advisor & Game Master:** An on-demand AI system can evaluate Courses of Action (COAs), assess Battle Damage (BDA), handle Master Scenario Events List (MSEL) injects, and act as an AI \"Game Master\" handling opponent autonomy.

## System Architecture & Tech Stack

Overwatch is built as a modern TypeScript monorepo using npm workspaces:

- **Frontend:** React + Vite, visualizing interactions across 10 distinct pages.
- **State Management:** Zustand for client-side state, deeply integrated with WebSocket data feeds.
- **Backend:** Express.js + Node.js REST API and Socket.IO real-time server.
- **Database:** PostgreSQL + Prisma ORM (22 domain-specific tables including strategic, operational, force structure, space, and simulation entities).
- **AI Integration:** OpenAI API utilizing a tiered model strategy (`gpt-5.4` for flagship strategic synthesis, `gpt-5-mini` for planning documents, and `gpt-5-nano` for fast real-time parsing).
- **Domain Modeling:** SGP4 math for orbital satellite tracking and geographic coordinate calculations (MGRS).

## Project Structure

```text
overwatch/
├── client/              # React frontend (Vite)
├── server/              # Express.js backend (REST API + WebSocket + AI Services)
├── shared/              # Shared TypeScript types and schemas
├── scenarios/           # Ready-made scenario zipped exports
└── docs/                # Comprehensive project documentation
```

## Quick Start

Ensure you have Node.js (v20+ recommended) and a running PostgreSQL instance.

1. **Install dependencies from the root directory:**
   ```bash
   npm install
   ```

2. **Configure your environment:**
   Set up your `.env` file in the `server` directory with your PostgreSQL database URL and OpenAI API Key.

3. **Initialize the Database:**
   ```bash
   cd server
   npx prisma db push
   # Optional: Seed the database if you want foundational static reference data
   # npx prisma db seed
   ```

4. **Run the Development Server (Client + Server concurrently):**
   ```bash
   cd ..
   npm run dev
   ```
   The backend API runs on port 3000, and the Vite client runs on port 5173.

## Documentation & Deep Dives

The `docs/` directory contains extensive architectural and operational documentation. Key files include:

- [**System Architecture**](./docs/architecture.md) - Deep dive into database models, API structures, and data flows.
- [**AI Functions Reference**](./docs/ai-functions.md) - Details on prompts, validation logic, and the tiered model selection (`gpt-5.4` / `mini` / `nano`).
- [**Doctrine Cascade**](./docs/doctrine-cascade.md) - How National Defense Strategy flows down to concrete OPLANs.
- [**Scenario Pipeline**](./docs/scenario-pipeline.md) - The 9-step automated scenario builder pipeline.
- [**Data Model**](./docs/data-model.md) - The Prisma database schema and ERDs.

For a full index, see the [Documentation Index](./docs/README.md).

## Project Status

| Phase | Description | Status |
|---|---|---|
| **Phase A** | Base Schema & Doctrine Cascade | ✅ Complete |
| **Phase B** | AI Order of Battle & Campaign Plan Generation | ✅ Complete |
| **Phase C** | Daily Tasking Cycle (ATO/MTO/STO) | ✅ Complete |
| **POC #1** | Narrative → Structured Data (Findings, ATO, KG) | ✅ ~80% Complete |
| **POC #2** | Space Domain AI Decision Support System | ⏳ Pending |
| **Phase D** | Adversary Modeling & Red Force Autonomy | ⏳ Pending |
| **Phase E** | Multi-User Collaborative Wargaming | ⏳ Pending |
