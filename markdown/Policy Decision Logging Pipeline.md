---
itemId: Policy-Decision-Logging-Pipeline
itemType: Software Item Spec
itemFulfills: SNPE-10
---

# Policy Decision Logging Pipeline (Markdown)

The logging pipeline shall implement: (1) Per-core ring buffers (DPDK rte_ring) for lock-free log event capture in the data plane, (2) Log aggregation thread consuming from all per-core rings with batched writes, (3) CEF and JSON formatters with configurable field selection, (4) Streaming export via TCP/TLS to syslog (RFC 5424) and via Kafka for SIEM integration, (5) Sampling mode (1:N) for high-throughput deployments exceeding 1M decisions/second. Buffer overflow shall trigger oldest-event-drop policy.

