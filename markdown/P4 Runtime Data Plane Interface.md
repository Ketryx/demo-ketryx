---
itemId: P4-Runtime-Data-Plane-Interface
itemType: Software Item Spec
itemFulfills: SNPE-8
---

# P4 Runtime Data Plane Interface (Markdown)

The P4 runtime shall implement: (1) P4Info-based table management API for inserting/deleting/modifying match-action entries, (2) Custom extern functions for accessing the connection table, NAT table, and QoS scheduler, (3) P4 program compilation to eBPF bytecode for execution in the kernel fast-path, (4) Hot-reload of P4 programs without traffic disruption using atomic program swapping. P4 programs shall be sandboxed using eBPF verifier to prevent unsafe memory access.
