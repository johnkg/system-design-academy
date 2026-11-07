# Walkthrough baseline: hand check

`scripts/walkthrough-baseline.json` lists numbers in "how to try it" steps that `npm run check:walkthroughs` cannot reproduce on its own. Every one of the 86 numbers was checked by hand by replaying the step in a browser (the exact sequence of Reset, settings and button presses, including text boxes and the three days of the monitoring page). None contradicts its simulation.

How each number is accounted for:

- **S**: Shown exactly when the step is replayed (39)
- **R**: Shown, rounded (12)
- **U**: Shown in another unit or format (11)
- **D**: Arithmetic on shown values (13)
- **M**: An input or a model parameter, not an output (11)

The checker misses the S group because it sets controls from a step by label and cannot type into text boxes, press Reset between settings, or replay a sequence of presses. The others are not shown in the form the step quotes. Edit a step so a number changes and the check asks again; add to the baseline only after a hand check like this one.

| Page | Number | How | Detail |
|---|---|---|---|
| `/case-studies/alerting-and-on-call-system/` | 246 | D | fault at minute 30 + the 216 minutes shown |
| `/case-studies/authentication-system/` | 19,861 | S | Spraying + lockout, lock after 3 |
| `/case-studies/ci-cd-system/` | 16.9 | S | Autoscaled pool, 8 shards |
| `/case-studies/ci-cd-system/` | 142 | S | Autoscaled pool, 8 shards |
| `/case-studies/cloudflare-unimog/` | 49 | S | Reset, Drain A wait, 50% ended |
| `/case-studies/data-warehouse/` | 16.5 | D | 34.7 GB / 2.1 GB |
| `/case-studies/ddos-protection-service/` | 96,000 | U | the page says "96k requests per second" |
| `/case-studies/digital-wallet/` | 1.6 | S | Two-phase commit, downtime 2 s |
| `/case-studies/discord-trillions-of-messages/` | 120 | S | Reset, coalescing on, 12 instances |
| `/case-studies/distributed-tracing-system/` | 58 | S | 100% head sampling, tail on, wait 1 s |
| `/case-studies/distributed-tracing-system/` | 5.7 | D | 70,706 / 12,431 buffered traces (60 s vs 10 s) |
| `/case-studies/document-database/` | 12.5 | D | 100% / 8 shards |
| `/case-studies/dropbox-magic-pocket/` | 2.02 | S | Reset, compact below 50 |
| `/case-studies/dropbox-magic-pocket/` | 2.90 | S | Reset, under-filled 20 |
| `/case-studies/dropbox-magic-pocket/` | 2.31 | S | Reset, under-filled 20, compact below 10 |
| `/case-studies/email-service/` | 69 | R | 68.6 (per-domain queues, skip bounces, retry every minute) |
| `/case-studies/email-service/` | 62 | R | 61.8 (the second send) |
| `/case-studies/fraud-detection-system/` | 5,016 | S | Shadow mode, 3 payments, $200 floor: "would have given +$5,016" |
| `/case-studies/gpu-cluster-scheduler/` | 53 | S | Gang + rack placement; then backfill + fair share |
| `/case-studies/gpu-cluster-scheduler/` | 75 | S | Gang + rack placement; then backfill + fair share |
| `/case-studies/gpu-cluster-scheduler/` | 50 | S | Gang + rack placement; then backfill + fair share |
| `/case-studies/gpu-cluster-scheduler/` | 80 | S | Gang + rack placement; then backfill + fair share |
| `/case-studies/gpu-cluster-scheduler/` | 12 | S | Gang + rack placement; then backfill + fair share |
| `/case-studies/graphql-federation-gateway/` | 10 | M | 10 items per list in the model; consistent with the 11,110 objects shown |
| `/case-studies/inventory-management-system/` | 1,600 | D | 16 slices x 100 requests per tick |
| `/case-studies/inventory-management-system/` | 34 | U | sale queue "last sale after 3400 ms" at 100 ms per tick, 1 slice |
| `/case-studies/inventory-management-system/` | 12 | U | single row "last sale after 1200 ms", 1 slice |
| `/case-studies/linkedin-kafka-log/` | 200,000 | S | Reset, 400 thousand per second, 500 ms lag |
| `/case-studies/live-comments-and-reactions/` | 11.1 | U | drop oldest shows 11,090,000 |
| `/case-studies/live-streaming-platform/` | 3.3 | U | shield load 3,335,193 per second |
| `/case-studies/llm-inference-gateway/` | 24 | D | 384 rejected of 1,577 requests |
| `/case-studies/llm-inference-gateway/` | 429 | M | the HTTP status code |
| `/case-studies/log-aggregation/` | 125 | R | 125.1 s |
| `/case-studies/maps-and-routing-service/` | 19 | R | 18.9 min at the defaults |
| `/case-studies/proximity-service/` | 235 | S | Countryside, 8 km, fixed grid, 1 km cells |
| `/case-studies/serverless-platform/` | 2.6 | D | $0.1196 / $0.0452 (steady, 30 provisioned vs none) |
| `/case-studies/service-discovery-registry/` | 0.25 | S | Self-preservation on, retry once |
| `/case-studies/service-mesh/` | 1,024 | D | peak 512,000 per second / 500 per second from users (4 retries at 5 hops) |
| `/case-studies/shopify-flash-sales/` | 26.8 | S | Reset, pods, earliest first, slow session store |
| `/case-studies/slack-job-queue/` | 18.6 | S | Reset, Redis stops 15 min, Kafka, matched limit |
| `/case-studies/stock-exchange/` | 200 | M | the quantity typed into the order form |
| `/case-studies/time-series-database/` | 145 | R | 145.3 GB with raw points and user_id |
| `/case-studies/video-conferencing/` | 16.5 | D | 11 copies x the 1,500 kbit/s stream in the model text |
| `/case-studies/virtual-waiting-room/` | 150 | M | admission rate typed in |
| `/case-studies/virtual-waiting-room/` | 40,000 | S | token queue at 150 per second |
| `/case-studies/virtual-waiting-room/` | 400 | S | token queue at 150 per second |
| `/case-studies/virtual-waiting-room/` | 20 | M | admission rate typed in |
| `/case-studies/virtual-waiting-room/` | 32,000 | D | "more than 32,000": the page shows 32,508 |
| `/case-studies/vpn-gateway-service/` | 44 | D | NAT timeouts spread 30 to 60 s, keepalive 45 s: those under 45 s are dropped |
| `/concepts/authentication-and-authorization/` | 403 | S | log in, then GET /orders/bob-1 |
| `/concepts/batch-vs-stream-processing/` | 190 | S | Reset, batch every 1 min |
| `/concepts/batch-vs-stream-processing/` | 20047 | S | Reset, batch every 1 min |
| `/concepts/blue-green-and-rolling-deployments/` | 1,500 | S | surge 0, unavailable 2, Run (the page prints 1500) |
| `/concepts/columnar-formats-and-partitioning/` | 155 | R | 154.6 MB, no partitioning, 64 files per day |
| `/concepts/continuous-batching-and-model-serving/` | 4,000 | M | long prompts in the model are 2,000 to 3,999 tokens |
| `/concepts/graphql-n-plus-one-and-dataloader/` | 28 | D | 90 keys = 50 + 12 prolific writers + 28 |
| `/concepts/graphql-n-plus-one-and-dataloader/` | 2.5 | M | join width (tables + 1) / 2 for 4 tables, from the model |
| `/concepts/graphql-n-plus-one-and-dataloader/` | 24 | R | 24.1 ms with batching + cache |
| `/concepts/guardrails-and-prompt-injection/` | 75 | M | classifier threshold typed in |
| `/concepts/guardrails-and-prompt-injection/` | 25 | M | classifier threshold typed in |
| `/concepts/http-caching-headers/` | 908 | R | 907.7 KB |
| `/concepts/http-caching-headers/` | 1153 | R | 1152.5 KB with no-store |
| `/concepts/http-caching-headers/` | 4.5 | U | 4502.5 KB |
| `/concepts/http-caching-headers/` | 0.45 | U | 448.7 KB |
| `/concepts/inverted-indexes-and-text-search/` | 4.682 | S | type the query, choose Ranked, Build index (2 shards for the last two) |
| `/concepts/inverted-indexes-and-text-search/` | 3.296 | S | type the query, choose Ranked, Build index (2 shards for the last two) |
| `/concepts/inverted-indexes-and-text-search/` | 5.075 | S | type the query, choose Ranked, Build index (2 shards for the last two) |
| `/concepts/inverted-indexes-and-text-search/` | 2.749 | S | type the query, choose Ranked, Build index (2 shards for the last two) |
| `/concepts/jwt-and-session-tokens/` | 333 | R | 333.31 refreshes per second |
| `/concepts/load-shedding/` | 18 | S | bounded policy, limit 400, Run |
| `/concepts/load-shedding/` | 1,663 | S | bounded policy, limit 400, Run |
| `/concepts/load-shedding/` | 1.8 | U | 1,819 ms average latency |
| `/concepts/merkle-trees-and-anti-entropy/` | 0.5 | U | 488 KB to repair |
| `/concepts/metrics/` | 145 | R | p99 144 ms at 0% slow; the step says "about 100 to 145 ms" |
| `/concepts/multi-region-failover/` | 3600 | U | "Downtime 60 min" with a 1 hour TTL |
| `/concepts/optimistic-concurrency-and-etags/` | 496 | S | version check with auto-retry, 12 agents, 1 customer |
| `/concepts/ordering-and-partitioning/` | 191 | S | partitioned, 8 partitions, 8 consumers, retry later, reorder buffer |
| `/concepts/query-planning-and-joins/` | 536 | R | hash join cost 536.2 (large, IS, heap) |
| `/concepts/synthetic-monitoring-and-rum/` | 500 | M | low end of a range: the page shows 537 and 595 on days A to C |
| `/concepts/synthetic-monitoring-and-rum/` | 600 | M | high end of the same range |
| `/concepts/synthetic-monitoring-and-rum/` | 120 | S | day B, 5 locations, 2 of 3 |
| `/concepts/synthetic-monitoring-and-rum/` | 26 | S | day C, 5 locations, every minute |
| `/concepts/tcp-congestion-control/` | 23,040 | U | Transfer time 23.0 s |
| `/concepts/unique-id-generation/` | 1,808 | S | 5,000 per node, wrap to 0 |
| `/concepts/unique-id-generation/` | 19 | D | 38 ms total waiting / 2 nodes |
| `/concepts/unique-id-generation/` | 500 | S | refuse to issue ids after the clock moves back |
