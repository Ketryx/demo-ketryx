---
itemId: Secure-Policy-Distribution-Protocol
itemType: Software Item Spec
itemFulfills: SNPE-7
---

# Secure Policy Distribution Protocol (Markdown)

Policy updates shall be distributed via a custom protocol over TLS 1.3 using the following sequence: (1) Management plane generates policy delta, (2) Delta is serialized using Protocol Buffers, (3) HMAC-SHA-256 is computed over the serialized payload using a per-device key derived via HKDF, (4) Payload is transmitted over mTLS connection, (5) Data plane verifies HMAC before deserializing, (6) Policy is applied atomically using RCU (Read-Copy-Update) to avoid traffic disruption. Rollback is automatic if verification fails.
