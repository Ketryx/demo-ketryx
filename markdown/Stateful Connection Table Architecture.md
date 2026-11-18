---
itemId: Stateful-Connection-Table-Architecture
itemType: Software Item Spec
itemFulfills: SNPE-1
---

# Stateful Connection Table Architecture (Markdown)

The connection table shall use a lock-free concurrent hash map (Cuckoo hashing with 4-way associativity) stored in hugepage-backed memory. Each entry shall contain: 5-tuple, protocol state machine state, sequence number tracking (TCP), NAT translation, QoS class, and timestamps. Aging shall use a hierarchical timing wheel with 1-second granularity. Table shall support 10M entries with O(1) average lookup and insertion.
