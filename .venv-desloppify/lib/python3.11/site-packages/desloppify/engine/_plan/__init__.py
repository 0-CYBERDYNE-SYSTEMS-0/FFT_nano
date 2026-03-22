"""Internal plan implementation package (not a public import surface).

This package owns plan internals: schema, operations, triage internals, and
sync policy. Callers should route through focused public facades where they
exist (for example ``engine.plan_state``, ``engine.plan_ops``,
``engine.plan_triage``) instead of treating this package as a generic grab-bag.

Subpackages:
- schema: PlanState TypedDict and migration logic
- operations: queue/skip/cluster/meta/lifecycle mutations
- triage: whole-plan triage implementation + staged triage playbook
- policy: subjective/stale/project policy helpers
- sync: queue sync modules (context, dimensions, triage, workflow)

Other modules:
- persistence: JSON read/write with atomic saves
- scan_issue_reconcile: post-scan stale/dead-reference synchronization
- auto_cluster: automatic issue clustering
- commit_tracking: git commit↔plan-item linking

"""
