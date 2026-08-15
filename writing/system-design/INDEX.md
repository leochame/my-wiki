# System Design Index

Choosing the right technology to do the job right is more important than explaining how the technology works in detail.

## The Four Key Phases of System Design

A solid system design interview or exercise moves through four phases in order. Skipping ahead or rushing a phase usually leads to rework.

### Phase 1: Ask Key Questions, Get Answers

Before proposing anything, clarify scope. The worst mistake is designing the wrong system.

- **Functional requirements** — What does the system actually do? What features are in scope vs. out of scope?
- **Non-functional requirements** — Availability, consistency, latency, durability. Which ones matter most?
- **Scale and usage patterns** — How many users? Read-heavy or write-heavy? What are the peak traffic patterns?
- **Constraints** — Are we building for mobile, web, both? Any existing systems to integrate with?

Output: a crisp list of what we're building and what we're explicitly NOT building.

### Phase 2: Back-of-the-Envelope Estimation

Crunch rough numbers to size the system. This reveals bottlenecks before any design is drawn.

- **Throughput** — Requests per second (read and write separately)
- **Storage** — Total data stored over time (5-year horizon typical)
- **Bandwidth** — Ingress and egress per second
- **Memory/cache** — Working set size, cache hit ratio assumptions

Use round numbers and powers of 10. The goal is not precision — it's knowing whether you need 10 servers or 10,000.

### Phase 3: Propose High-Level Design, Get Buy-In

Draw the big picture. Keep it at the box-and-arrow level. Walk through the critical flows end-to-end to validate the design.

- **System architecture diagram** — Major components (clients, load balancers, services, databases, object stores, CDNs, queues)
- **Data flow walkthrough** — Trace a core request through every box
- **API sketch** — What do the key endpoints look like?
- **Data model sketch** — What are the major entities and their relationships?

Get agreement before diving deeper. If the high-level design is wrong, no amount of detail fixes it.

### Phase 4: Deep Dive into Key Components

Zoom into the components that are most interesting or challenging for this specific system. These vary by system type, but common deep-dive areas:

- **Bottleneck components** — The piece most likely to break under scale
- **Data partitioning strategy** — Sharding key choice, hot-spot mitigation
- **Consistency model** — Where can we be eventually consistent? Where must we be strongly consistent?
- **Fault tolerance** — What happens when component X fails?
- **Optimization** — Caching layers, pre-computation, async processing, CDN strategy

Output: a detailed design for the hardest parts, with trade-offs explained.
