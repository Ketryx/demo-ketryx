---
itemId: IPv6-Dual-Stack-Processing-Pipeline
itemType: Software Item Spec
itemFulfills: SNPE-5
---

# IPv6 Dual-Stack Processing Pipeline (Markdown)

The IPv6 pipeline shall share the same processing stages as IPv4 with protocol-specific handlers for: (1) Extension header parsing (Hop-by-Hop, Routing, Fragment, Destination, AH, ESP) with configurable maximum chain length (default 6), (2) NAT64 using algorithmically mapped addresses per RFC 6052, (3) NAT66 using NPTv6 per RFC 6296, (4) Transition mechanism detection and policy enforcement for 6to4, ISATAP, and Teredo tunnels. Fragment reassembly shall use a dedicated buffer pool with 30-second timeout.


