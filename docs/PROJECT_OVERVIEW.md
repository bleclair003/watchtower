# WATCHTOWER — Project Overview

**WT-01 · Geopolitical Intelligence & Early Warning Platform**

WATCHTOWER is a single-operator OSINT monitoring console. It collects public information from official government, military, maritime, aviation and cyber sources, plus global news context. It classifies and maps that information, evaluates configurable indicators, and alerts the operator. The design follows a Cold War command-centre aesthetic, but the console's job is analytical: provenance, uncertainty and source health are always visible.

## What it is

- An aggregator and organizer of public, sourced information, with every record traceable to its origin.
- A deterministic indicator engine (Phase 3) that flags observable conditions and unusual frequency changes.
- A personal tool, running at $0 recurring cost.

## What it is not

- Not a predictive system. The Regional Activity Index measures *unusual activity in the monitored sources*, not the probability of conflict.
- Not real-time. Collection is hourly and best-effort.
- Not a surveillance tool. No personal data, no individual tracking, no inference of live military deployments from sensitive tracking data.

## Core loop

COLLECT → VERIFY → CLASSIFY → CORRELATE → DISPLAY → ALERT → INVESTIGATE → ARCHIVE

## Current status (2026-11-20)

Phase 0 is complete, and Phase 1 is complete on a clearly labelled **demonstration dataset**. No live data is collected yet; Phase 2 adds the first collectors. See [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md).

## Document index

| Doc | Contents |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design, folder layout, Task A review & risks |
| [SOURCE_REGISTRY.md](SOURCE_REGISTRY.md) | Source feasibility matrix |
| [DATA_MODEL.md](DATA_MODEL.md) | Entities, Firestore collections, indexes, retention |
| [INDICATOR_ENGINE.md](INDICATOR_ENGINE.md) | Indicator & Warning Engine and RAI |
| [ALERTING.md](ALERTING.md) | Alert rules, delivery, Discord, cooldowns |
| [DOSSIERS.md](DOSSIERS.md) | Incident dossiers, assessments, timelines, export |
| [ANALYSIS.md](ANALYSIS.md) | SITREP, historical replay, backtesting, trends, experimental signals |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Tokens, typography, symbols, effects |
| [TESTING.md](TESTING.md) | Test commands and coverage |
| [DEPLOYMENT.md](DEPLOYMENT.md) | $0 hosting path, quotas, setup checklist, secrets |
| [SECURITY_AND_ACCESSIBILITY.md](SECURITY_AND_ACCESSIBILITY.md) | Phase 7 security review, threat model, accessibility audit |
| [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md) | Milestone checklist |
| [CHANGELOG.md](CHANGELOG.md) | Release history |
