---
itemId: DDoS-Mitigation-and-Rate-Limiter
itemType: Software Item Spec
itemFulfills: SNPE-9
---

# DDoS Mitigation and Rate Limiter (Markdown)

The DDoS mitigation module shall implement: (1) SYN cookie validation using HMAC-SHA-256 keyed with a rotating secret (rotation every 60s), (2) UDP rate limiter using token bucket per-source with configurable burst (default 100 packets), (3) DNS amplification filter using response-rate-limiting (RRL) with slip rate of 2, (4) Connection rate limiter using sliding window counters (1-second resolution) with per-source, per-destination, and per-service granularity. All thresholds shall be dynamically adjustable via the management API. Change 4



