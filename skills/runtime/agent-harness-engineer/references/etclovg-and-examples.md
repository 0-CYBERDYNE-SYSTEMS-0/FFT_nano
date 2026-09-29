# ETCLOVG Layer Details and Real-World Examples

## ETCLOVG Taxonomy (from Agent Harness Engineering Survey)

- **Execution (E)**: Sandboxes, microVMs (Hyperlight), container isolation, browser/computer-use environments, OS permission models. Failure mode without it: unsafe side effects or non-reproducible runs.

- **Tooling (T)**: MCP, A2A protocols, schema validation, tool selection heuristics, error feedback quality. Keep tools narrowly scoped.

- **Context (C)**: Compaction strategies, progressive disclosure (skills), filesystem as memory primitive, knowledge graphs, trajectory logging. Fights context rot.

- **Lifecycle (L)**: Plan-act-observe loops, state machines, subagent spawning/handoffs, Ralph-style continuation across sessions, branching/retries.

- **Observability (O)**: Full trajectory traces, cost tracking, failure attribution per layer.

- **Verification (V)**: Hard signals (unit tests, coverage, formal checks) preferred; soft critiques as secondary. Step-level gates over end-of-run only.

- **Governance (G)**: RBAC/OPA policies, human approval gates, audit logs, token/budget limits, identity.

## Fusion Harness Examples

- **fusionHarness (Mixture-of-Agents)**: Parallel panel of models → judge extracts consensus/contradictions/unique insights → synthesizer produces final answer. Beats single models; budget panels rival frontier cost-effectively. Integrates as drop-in OpenAI-compatible endpoint or internal council tool.

- **Planner-Generator-Evaluator**: Adversarial multi-agent. Planner decomposes; Generator implements; Evaluator critiques with multi-dimensional criteria. Dramatically raises quality at higher cost (e.g., +70pp usability in reported cases).

- **HarnessX / AEGIS**: Treat harness as composable processors on lifecycle hooks. Trace-driven multi-agent evolution of components.

- **HarnessForge**: Joint harness-policy co-evolution via fault-guided tailoring and alignment.

- **AgentFlow**: Typed graph DSL for synthesizing multi-agent harnesses (roles, topology, tools, protocols) guided by runtime signals from the target (e.g., coverage for vuln discovery).

## Specialized Industry Harnesses

- Industrial (XMPro Agentic Harness): Native OT data streams + cognitive Observe-Reflect-Plan-Act cycles + specialist teams.

- Coding (Claude Code, Cursor, Aider): Git + shell + tests as first-class; high verification density; user harness (conventions + skills) layered on coding harness.

- Vision (Ultralytics-style): LLM reasons; deterministic harness applies thresholds and rules on perception outputs.

- Security: Multi-agent with coverage feedback loops for zero-day discovery.

Use these patterns as starting templates; always re-specialize to the exact task distribution and risk profile.
