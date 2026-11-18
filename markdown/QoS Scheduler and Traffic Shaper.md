---
itemId: QoS-Scheduler-and-Traffic-Shaper
itemType: Software Item Spec
itemFulfills: SNPE-6
---

# QoS Scheduler and Traffic Shaper (Markdown)

The QoS subsystem shall implement: (1) Strict priority scheduler for real-time traffic classes (voice, video), (2) Weighted Deficit Round Robin (WDRR) for remaining 6 classes, (3) Token bucket policer with dual-rate three-color marking (srTCM/trTCM per RFC 2697/2698), (4) Hierarchical token bucket (HTB) shaper for egress rate limiting. DSCP-to-queue mapping shall be configurable per-interface. Scheduling decisions shall be made per-packet with O(1) complexity.

