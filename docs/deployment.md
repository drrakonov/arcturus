# Deployment preparation: AWS EC2 or Render Free

Status: deployment preparation only. No cloud resources have been provisioned.
The user selected **AWS EC2 Free Tier or Render Free Tier**. Oracle is not a target.
Account-specific eligibility is a deployment-time check, not a prerequisite for local
implementation; do not request billing details during baseline development.

## EC2: preferred architectural fit, conditional free usage

Keep the API, engine, WebSocket server, database processor and market maker as separate
logical services, with Redis and TimescaleDB on one Linux instance using Compose.
This milestone repairs the existing local Compose stack; full application containers,
frontend delivery and TLS deployment belong to later milestones.

Official documentation checked on 2026-10-13:

- [EC2 Free Tier eligibility](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-free-tier-usage.html):
  accounts created on/after 2025-07-15 have a six-month/credit-limited offer. Eligible
  types include t3.micro, t3.small, t4g.micro and t4g.small. The older 12-month offer
  applies only to eligible older accounts; it is not perpetual free hosting.
- [AWS Free plan](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html):
  distinguish the Free plan from a paid account using promotional credits. Do not
  provision chargeable resources or assume credits remain without checking at deployment.
- [T3 resources](https://aws.amazon.com/ec2/instance-types/t3/): t3.micro has 2 burstable
  vCPUs/1 GiB RAM; t3.small has 2 burstable vCPUs/2 GiB RAM. A micro instance is not
  assumed sufficient for all services. Measure before selecting a size. Use Standard
  CPU-credit mode to avoid Unlimited surplus charges, accepting throttling.
- [Public IPv4 pricing](https://aws.amazon.com/vpc/pricing/): public IPv4 has a separate
  charge; EBS, transfer and other resources also need checking against the actual offer.
  No NAT gateway, load balancer, RDS, ElastiCache or paid domain is required by this plan.

EC2 supports long-running services and persistent EBS-backed data. Resource fit,
credit lifetime and account eligibility are unverified. Do not promise indefinite
zero-cost hosting. Instance shutdown alone does not remove all storage/network costs.

## Render Free: compact, restartable fallback

- [Compute](https://render.com/docs/compute-plans): 512 MB RAM / 0.1 CPU for the Free
  web instance; no free standalone background-worker instance.
- [Free limitations](https://render.com/docs/free): 15-minute idle sleep, ephemeral
  filesystem, 750 free instance hours per workspace/month; free PostgreSQL expires
  after 30 days. These constraints make unchanged five-service hosting unsuitable.
- [Workspace allowances](https://render.com/docs/new-workspace-plans): current Hobby
  allowance is 5 GB outbound bandwidth. Build/transfer quotas can interrupt service;
  do not add paid overages to satisfy availability.
- [Docker](https://render.com/docs/docker) and [WebSockets](https://render.com/docs/websocket)
  are supported. This does not prove a particular multiprocess application fits.

A compact profile would retain real Redis messaging, combine deployment processes,
use a SQLite history adapter and start a labelled fresh demo generation after restart.
It needs a measured prototype; it is not implemented. Do not rewrite persistence
prematurely or substitute fake executions. Keep bounded history, orders and simulation.

## Local baseline and deferred deployment verification

1. Run `npm run bootstrap`, `npm run build`, `npm run typecheck`, `npm test`.
2. With Docker available, run `npm run infra:up` on a disposable database. Check
   worker startup/migrations. Run `npm start` with a fresh engine and no simulator.
3. Run `SMOKE_DISPOSABLE=1 npm run smoke`: HTTP -> Redis -> engine -> stored trades
   and WebSocket events. This mutates seeded accounts and requires an empty book/database.

User-approved deferral (2026-10-14): the following cloud provisioning, public transport
and full-stack resource checks belong to **Milestone 6**, not Milestone 0 acceptance.

4. Provision the selected eligible cloud prototype. Inspect image platforms with `node scripts/image-platforms.mjs`; verify the actual
   architecture (amd64 for T3, arm64 for T4g) and run migrations on it.
5. Measure idle/load memory, CPU, disk growth and outbound traffic on the selected size.
6. At deployment, confirm free eligibility, public HTTPS/WebSockets and restart behavior.

Node, Redis and TimescaleDB are now pinned to the exact digests from the user-run
successful build and pulls. The platform script inspects those pinned references.
The public registry probe previously timed out; ARM compatibility remains unverified.
Local isolated startup, migrations and HTTP/Redis/engine/database/WebSocket integration
passed. SQL verified one trade and two fully filled order rows on PostgreSQL 17.11 x86_64.

A user-provided idle snapshot measured Redis at 3.957 MiB, TimescaleDB at 195.5 MiB,
and the database worker at 22.59 MiB (222.047 MiB combined). API, engine and WebSocket
processes were stopped. The host reported a 14.78 GiB limit; these are not measurements
under a small-instance cap. Full-stack idle/load memory, overhead and growth remain
unmeasured. Do not infer EC2 or Render capacity from this partial sample.

Cloud eligibility, resource fit, public TLS URL and a zero-cost deployed application
have not been verified. Local migrations and pipeline integration have passed. See PROGRESS.md for exact verification results.
