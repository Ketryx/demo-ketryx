---
itemId: L7-Application-Classification-Engine
itemType: Software Item Spec
itemFulfills: SNPE-2
---

# L7 Application Classification Engine (Markdown)

The DPI engine shall implement a three-stage classification pipeline: (1) Protocol detection via deterministic finite automaton (DFA) matching on first 16 bytes, (2) Pattern matching using Hyperscan regex library for 5,000+ signatures compiled to SIMD-optimized bytecode, (3) Behavioral classification using flow-level ML model for encrypted traffic where protocol detection is inconclusive. Classification results shall be cached per-flow in the connection table.
