---
itemId: Identity-Aware-Policy-Evaluation-Engine
itemType: Software Item Spec
itemFulfills: SNPE-4
---

# Identity-Aware Policy Evaluation Engine (Markdown)

The policy engine shall implement a two-phase evaluation: (1) Fast-path using a compiled decision tree (RFC algorithm - Recursive Flow Classification) for 5-tuple matching, (2) Slow-path using workload identity resolution via gRPC calls to the identity service for tag/label/security-group matching. Compiled decision trees shall be regenerated on policy update using incremental compilation. Maximum rule evaluation time for 100K rules: 2 microseconds fast-path, 100 microseconds slow-path.

