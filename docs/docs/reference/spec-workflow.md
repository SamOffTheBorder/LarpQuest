---
sidebar_position: 4
title: Spec Workflow
---

# Spec Workflow

The project uses [OpenSpec](https://github.com/Fission-AI/OpenSpec) for spec-driven development. Work is proposed and specified before it is implemented, and specs live in the repo alongside the code.

## Why

The [build order](/phases/build-order) is a fixed dependency chain, and the architecture has constraints that are easy to violate accidentally — the no-genre-conditionals rule most of all. Writing specs first makes those constraints checkable *before* code exists, rather than discovering a leaked assumption at a phase exit criterion.

## Structure

```
openspec/
  config.yaml                    Project context and per-artifact rules
  changes/
    phase-1-generic-core/
      proposal.md                Why, what changes, capabilities, non-goals
      design.md                  How — decisions, alternatives, risks
      specs/<capability>/spec.md Requirements with WHEN/THEN scenarios
      tasks.md                   Checkbox implementation breakdown
```

## The four artifacts

Artifacts build in dependency order. `proposal` unlocks `specs` and `design`; `tasks` requires the rest.

| Artifact | Answers | Contains |
|---|---|---|
| **proposal** | Why? | Motivation, what changes, which capabilities, non-goals |
| **specs** | What? | Testable requirements — each scenario is a potential test case |
| **design** | How? | Technical decisions with alternatives considered, risks, migration |
| **tasks** | In what order? | Checkboxes, grouped and dependency-ordered |

## Spec format

Requirements use SHALL/MUST. Every requirement needs at least one scenario, and scenarios use exactly four hashtags.

```markdown
## ADDED Requirements

### Requirement: Publication precedes extraction
A chapter SHALL be published as soon as generation and persistence succeed.
Extraction MUST run after publication and MUST NOT be able to block, delay,
or reverse it.

#### Scenario: Extraction fails
- **WHEN** state extraction fails for a published chapter
- **THEN** the chapter remains published and readable, and extraction is
  queued for retry
```

## Project rules

`openspec/config.yaml` encodes the architecture's constraints so every proposal is held to them:

**Proposals must** name their build-plan phase, include non-goals, and be rejected if they require a conditional on genre, universe, or media type in engine code.

**Designs must** name each model call's role, parse every structured output through Zod, specify RLS for new persisted state, and state failure behavior explicitly — on timeout, on invalid output, and on retry exhaustion.

**Tasks must** be at most two hours each, and any task adding a table or column includes its migration.

## Commands

```bash
openspec list                              # list changes
openspec show <change>                     # view a change
openspec status --change <change>          # artifact completion
openspec validate <change>                 # check spec format
openspec new change "<name>"               # scaffold a new change
openspec archive <change>                  # fold into openspec/specs/ when done
```

Slash commands are also available in Claude Code: `/opsx:propose`, `/opsx:apply`, `/opsx:archive`, `/opsx:sync`, `/opsx:explore`.

## Lifecycle

1. **Propose** — `openspec new change`, then write the four artifacts
2. **Validate** — `openspec validate <change>` must pass
3. **Apply** — implement, checking off tasks as they complete
4. **Archive** — `openspec archive <change>` folds the deltas into `openspec/specs/`, which becomes the living specification of what the system does

Archived specs are why later changes can declare **Modified Capabilities**: the current behavior is written down, so a change describes a delta against it rather than re-describing the system.
