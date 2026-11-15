# Tender Pocket — Production Deployment Guide

**Target:** Production  
**AWS Region:** `ap-south-1` (Mumbai)  
**Stack:** Next.js + Spring Boot / Java 21 + PostgreSQL 16 + Docker Compose + Amazon S3 + Gemini V1 + SMTP

---

## 1. Purpose

This document is the production deployment runbook for Tender Pocket.

It covers:

- AWS infrastructure
- IAM and EC2 instance role
- networking and security groups
- private S3 document storage
- PostgreSQL 16
- Docker Compose
- production secrets
- Gemini V1 AI configuration
- SMTP
- Nginx and HTTPS
- existing data and document migration
- scheduled PostgreSQL backups
- backup restore testing
- monitoring and alerts
- GeM ingestion and scheduled jobs
- production build and release procedure
- smoke testing
- rollback and recovery
- final production sign-off
- office-hours EC2 schedule (stopped 22:00–07:00 IST by EventBridge Scheduler, section 46)

This is a **production** guide. Do not reuse UAT credentials, UAT IP addresses, temporary API keys, or development secrets.

---

## 2. Production Architecture

```mermaid
flowchart TB
    U[Users / Browser] --> DNS[Production DNS]
    DNS --> TLS[HTTPS / TLS]
    TLS --> NGINX[Nginx]
    NGINX --> FE[Next.js Frontend :8085]
    FE --> BE[Spring Boot Backend :8090]

    BE --> DB[(PostgreSQL 16)]
    BE --> S3[(Private S3 Documents)]
    BE --> AI[Gemini V1]
    BE --> GEM[GeM Source]
    BE --> SMTP[SMTP]

    DB --> DUMP[pg_dump]
    DUMP --> BACKUP[(Dedicated Encrypted Backup S3)]

    EC2[Production EC2] --> CW[CloudWatch / Monitoring]
```

### Request flow

```text
Browser
  ↓ HTTPS
Production DNS
  ↓
Nginx
  ↓
Next.js frontend :8085
  ↓ /api
Spring Boot backend :8090
  ├── PostgreSQL
  ├── Private S3
  ├── Gemini V1
  ├── GeM
  └── SMTP
```

### Document flow

```text
Tender attachment
      ↓
Private S3
      ↓
Spring Boot
      ↓
Technical-specification AI service
      ↓
Structured compliance data
      ↓
Document generation
      ↓
PDF / DOCX / XLSX
      ↓
Private S3
```

PDF/DOCX/XLSX generation does **not** require AI. AI is used for technical-specification intelligence.

---

# 3. Production Sizing

The initial hosting plan uses:

- 2 vCPU
- 8 GiB RAM
- EC2 running in office hours only: started at 07:00 IST and stopped at 22:00 IST every day by EventBridge Scheduler (section 46)
- AWS Mumbai (`ap-south-1`)
- encrypted gp3 EBS
- approximately 50–100 GiB initial disk, adjusted for actual PostgreSQL, Docker, temporary-file, and application requirements

The planning workload includes approximately 20,000–30,000 historical tenders, 15–30 active users, and peak-session/tender-ingestion workloads.

Re-evaluate EC2 sizing using production metrics after go-live.

---

# 4. AWS Production Resources

Create the following resources:

```text
AWS
├── VPC
│   ├── subnet(s)
│   ├── route table
│   └── Internet Gateway / required routing
│
├── EC2 production application server
│
├── Production Security Group
│
├── Private S3 document bucket
│
├── Dedicated S3 backup bucket
│
├── IAM EC2 instance role
│
├── CloudWatch monitoring / alarms
│
└── Production DNS + HTTPS/TLS
```

Keep application resources in `ap-south-1` unless a documented production requirement requires another region.

---

# 5. Production S3 Document Bucket

Create a dedicated private bucket, for example:

```text
tender-pocket-prod-documents-<unique-suffix>
```

Required settings:

- Region: `ap-south-1`
- Block Public Access: enabled
- Object Ownership: Bucket owner enforced
- Server-side encryption: SSE-S3 or SSE-KMS
- Versioning: enabled according to the approved recovery policy
- Public ACLs: disabled
- No public bucket policy

Recommended logical layout:

```text
s3://<production-document-bucket>/
├── documents/
│   ├── tenders/
│   ├── specifications/
│   ├── generated/
│   └── templates/
```

Application documents remain private and are accessed through authorized backend operations or approved presigned URLs.

## Document retention

The hosting plan calls for archiving after 3 years.

Before enabling automatic archival or deletion:

1. Confirm legal retention requirements.
2. Confirm business retrieval requirements.
3. Confirm the approved retention policy.
4. Configure lifecycle rules only after approval.

Do not delete retained documents merely because they are old.

---

# 6. Dedicated PostgreSQL Backup Bucket

Create a **separate** bucket for database backups:

```text
tender-pocket-prod-backups-<unique-suffix>
```

Do not depend on the application document bucket as the only database recovery location.

Required settings:

- Region: `ap-south-1`
- Block Public Access: enabled
- Object Ownership: Bucket owner enforced
- Server-side encryption: enabled
- Versioning: enabled
- no public access

Recommended layout:

```text
s3://<production-backup-bucket>/
└── postgres/
    ├── daily/
    └── monthly/
```

---

# 7. IAM — EC2 Instance Role

Create an EC2 IAM role:

```text
TenderPocketProductionEC2Role
```

Trusted service:

```text
EC2
```

The application should use the EC2 instance role rather than long-lived AWS access keys.

Minimum application permissions for the document bucket should be limited to what the application actually requires.

Example:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListProductionBucket",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::<production-document-bucket>"
    },
    {
      "Sid": "ReadWriteProductionObjects",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::<production-document-bucket>/*"
    }
  ]
}
```

If the backup mechanism runs with the EC2 role, grant only the required backup permissions to the backup bucket.

Do not use `s3:*` without a documented reason.

Do not place AWS access keys or secret keys in `.env` when the EC2 role is available.

---

# 8. EC2 Production Server

Create the application server in `ap-south-1`:

- Ubuntu LTS
- x86_64
- 2 vCPU
- 8 GiB RAM
- gp3 EBS
- EBS encryption enabled
- approximately 50–100 GiB initial disk
- attach `TenderPocketProductionEC2Role`

Documents should live in S3 rather than permanently consuming the EC2 root disk.

---

# 9. Production Security Group

Recommended inbound rules:

| Port | Source | Purpose |
|---|---|---|
| 443 | Internet | HTTPS |
| 80 | Internet | Optional HTTP → HTTPS redirect |
| 22 | Restricted admin IP/VPN/bastion | Administration |

Do **not** expose these publicly:

```text
5432  PostgreSQL
8090  Spring Boot
8085  Next.js
```

Expected production path:

```text
Internet
   ↓
HTTPS
   ↓
Nginx
   ↓
Next.js / backend proxy
   ↓
PostgreSQL / S3 / Gemini / SMTP
```

Never allow production SSH from `0.0.0.0/0`.

---

# 10. Host Preparation

Update Ubuntu:

```bash
sudo apt update
sudo apt upgrade -y
```

Install required packages:

```bash
sudo apt install -y \
  git \
  curl \
  unzip \
  ca-certificates \
  gnupg \
  nginx \
  jq \
  postgresql-client
```

Install Docker Engine and the Docker Compose plugin using Docker's official installation procedure for the selected Ubuntu LTS release.

Verify:

```bash
docker --version
docker compose version
```

---

# 11. Clone the Production Release

Use the approved production repository and an immutable release commit or tag.

Example:

```bash
sudo mkdir -p /opt
cd /opt

sudo git clone <approved-production-repository-url> tender-pocket
sudo chown -R $USER:$USER /opt/tender-pocket

cd /opt/tender-pocket

git status
git rev-parse HEAD
```

Record the exact commit SHA deployed to production.

Do not deploy an unreviewed working tree.

---

# 12. Repository Structure

The production repository contains:

```text
tender-pocket/
├── backend/
│   ├── pom.xml
│   ├── Dockerfile
│   └── src/
│
├── frontend/
│   ├── package.json
│   ├── Dockerfile
│   └── src/
│
├── docker-compose.yml
└── ...
```

The Spring Boot backend is the authoritative API, workflow, and document-generation layer.

The Next.js application provides the frontend and API proxy layer.

---

# 13. PostgreSQL 16

The production Docker Compose stack uses:

```text
PostgreSQL 16
Database: tender_pocket
```

The initial architecture runs PostgreSQL in Docker on the same EC2 host.

The scale-up path is Amazon RDS PostgreSQL when availability, operations, or scale justify migration.

## Database configuration

The actual Compose configuration uses:

```env
POSTGRES_DB=tender_pocket
DATABASE_USERNAME=postgres
DATABASE_PASSWORD=<production-secret>
```

Spring Boot receives:

```env
SPRING_DATASOURCE_URL=jdbc:postgresql://postgres:5432/tender_pocket?sslmode=disable
SPRING_DATASOURCE_USERNAME=postgres
SPRING_DATASOURCE_PASSWORD=<production-secret>
```

Use the exact environment-variable names expected by the current Compose file.

## Persistent storage

PostgreSQL uses the persistent Docker volume:

```text
postgres_data
```

Never run production PostgreSQL without persistent storage.

Never run:

```bash
docker compose down -v
```

in production unless intentional database destruction has been explicitly approved and a verified restore path exists.

## Network

PostgreSQL must remain internal to the Docker network.

Never expose port `5432` publicly.

---

# 14. PostgreSQL Authority

Production PostgreSQL must be the authoritative application database.

The codebase has historically contained SQLite-related fallback behavior. Production must be configured and tested so that:

```text
Application
    ↓
PostgreSQL
```

is authoritative.

A PostgreSQL connection failure must not silently cause production to serve stale/local SQLite data.

---

# 15. Production `.env`

Create the production `.env` outside Git.

Example structure:

```env
POSTGRES_DB=tender_pocket
DATABASE_USERNAME=postgres
DATABASE_PASSWORD=<strong-production-password>

SPRING_DATASOURCE_URL=jdbc:postgresql://postgres:5432/tender_pocket?sslmode=disable
SPRING_DATASOURCE_USERNAME=postgres
SPRING_DATASOURCE_PASSWORD=<strong-production-password>

JWT_SECRET=<long-random-production-secret>
JWT_EXPIRATION=315360000

ADMIN_DEFAULT_PASSWORD=<production-secret>
MISTEAM_DEFAULT_PASSWORD=<production-secret>
EXECUTIVE_DEFAULT_PASSWORD=<production-secret>
CLEARANCE_DEFAULT_PASSWORD=<production-secret>
TPC_DEFAULT_PASSWORD=<production-secret>

AWS_REGION=ap-south-1
AWS_S3_BUCKET_NAME=<production-document-bucket>
AWS_S3_ENABLED=true

ALLOWED_ORIGINS=https://<production-domain>

BACKEND_URL=http://tender-pocket-backend:8090

GEMINI_API_KEY=<production-gemini-key>

SPRING_MAIL_HOST=smtp.gmail.com
SPRING_MAIL_PORT=465
SPRING_MAIL_USERNAME=<production-smtp-user>
SPRING_MAIL_PASSWORD=<production-smtp-password>
SPRING_MAIL_SMTP_AUTH=true

IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USERNAME=<if-required>
IMAP_PASSWORD=<if-required>
IMAP_SENDER_FILTER=<if-required>
```

Only define variables required by the release.

Protect the file:

```bash
chmod 600 /opt/tender-pocket/.env
```

Never commit:

- `.env`
- API keys
- JWT secrets
- SMTP passwords
- database passwords
- AWS access keys
- production credentials

---

# 16. Authentication

Generate a strong random production JWT secret.

Do not use development or UAT secrets.

Core roles include:

```text
admin
misteam
executive
clearance
tpc
```

Verify:

- each role can authenticate
- role-specific permissions work
- authorization is enforced by the backend
- restricted API endpoints cannot be accessed by unauthorized roles

Do not rely only on frontend-hidden buttons for security.

---

# 17. S3 Application Configuration

The current application expects:

```env
AWS_REGION=ap-south-1
AWS_S3_BUCKET_NAME=<production-document-bucket>
AWS_S3_ENABLED=true
```

The EC2 instance role supplies AWS credentials.

Do not configure:

```env
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

unless there is an explicitly approved architecture requiring them.

---

# 18. Gemini V1 AI Configuration

The current production AI direction is the **Gemini V1 technical-specification implementation**.

The AI-dependent functionality is technical-specification intelligence.

Normal PDF/DOCX/XLSX document rendering does not require AI.

Configure:

```env
GEMINI_API_KEY=<production-gemini-key>
```

Do not hardcode the Gemini key.

Do not commit the key to Git.

The original Azure OpenAI implementation should remain available as a reference/fallback implementation, but production must use the provider approved for the release.

For the current Gemini V1 release, verify that the application is actually using:

```text
AISpecificationIntelligenceServiceV1
```

and not silently falling back to the old Azure implementation.

---

# 19. Email / SMTP

The backend uses Spring Mail.

Configure a dedicated production mailbox:

```env
SPRING_MAIL_HOST=smtp.gmail.com
SPRING_MAIL_PORT=465
SPRING_MAIL_USERNAME=<smtp-user>
SPRING_MAIL_PASSWORD=<smtp-password>
SPRING_MAIL_SMTP_AUTH=true
```

Test:

- notification email
- approval-related email
- generated-document links
- production-domain links

Do not use temporary UAT Gmail credentials in production.

---

# 20. Docker Compose Services

The actual Compose **service names** are:

```text
postgres
tender-pocket-backend
tender-pocket-frontend
```

The container names are:

```text
tender-pocket-postgres
tender-pocket-backend
tender-pocket-frontend
```

This distinction is important.

For example:

```bash
docker compose build tender-pocket-backend
```

is correct.

This is **not** correct:

```bash
docker compose build backend
```

unless the Compose file is explicitly changed to define a `backend` service.

Expected dependency flow:

```text
tender-pocket-frontend
        ↓
tender-pocket-backend
        ↓
postgres
```

The backend also communicates with:

```text
S3
Gemini
GeM
SMTP
```

---

# 21. Production Build

From the project root:

```bash
cd /opt/tender-pocket
```

Check the release:

```bash
git status
git rev-parse HEAD
```

Build the complete stack:

```bash
docker compose build
```

For a deliberate clean build:

```bash
docker compose build --no-cache
```

The backend Dockerfile builds the Java application with Java 21.

The frontend Dockerfile builds the Next.js production application.

Do not deploy if the build fails.

---

# 22. Start Production

Start the complete stack:

```bash
docker compose up -d
```

Check:

```bash
docker compose ps
```

The expected services are:

```text
postgres
tender-pocket-backend
tender-pocket-frontend
```

Check logs:

```bash
docker compose logs --tail=100 postgres
docker compose logs --tail=100 tender-pocket-backend
docker compose logs --tail=100 tender-pocket-frontend
```

Look for startup failures, database connection errors, Spring bean errors, Gemini configuration errors, or frontend runtime failures.

---

# 23. Targeted Build / Restart

If only the application images changed, do not unnecessarily recreate PostgreSQL.

Backend + frontend:

```bash
docker compose build --no-cache tender-pocket-backend tender-pocket-frontend
docker compose up -d tender-pocket-backend tender-pocket-frontend
```

Then verify:

```bash
docker compose ps
```

PostgreSQL remains on its persistent volume.

---

# 24. Health Checks

## Frontend

The frontend is exposed locally on port `8085`.

```bash
curl -I http://localhost:8085/
```

## Backend

The Compose healthcheck uses:

```bash
curl -i http://localhost:8090/api/health
```

## Database

Use the actual container name:

```bash
docker exec tender-pocket-postgres \
  psql -U postgres -d tender_pocket \
  -c "SELECT current_database(), COUNT(*) FROM tenders;"
```

Do not place database passwords directly in shell commands if avoidable.

---

# 25. Nginx and HTTPS

Production must use a stable domain.

Example:

```text
tender.example.com
```

The public path is:

```text
https://tender.example.com
        ↓
      Nginx
        ↓
localhost:8085
        ↓
Next.js
        ↓
localhost:8090
```

Nginx should:

- terminate TLS when TLS is terminated on EC2
- redirect HTTP to HTTPS
- proxy to Next.js
- preserve required forwarding headers
- enforce appropriate request/body limits
- prevent public access to backend/database ports

If TLS is terminated by an AWS load balancer instead, use that architecture consistently.

Do not permanently operate production at:

```text
http://<public-ip>:8085
```

---

# 26. Existing Database Migration

When migrating an existing Tender Pocket environment:

1. Stop source writes.
2. Take a verified source backup.
3. Export PostgreSQL.
4. Transfer the backup securely.
5. Restore PostgreSQL.
6. Verify row counts.
7. Verify users and roles.
8. Verify audit history.
9. Verify S3 document references.
10. Verify representative tenders and documents.
11. Run smoke tests.
12. Open production writes only after verification passes.

Example:

```bash
pg_dump -Fc -d tender_pocket -f tender_pocket_YYYYMMDD.dump
```

Restore:

```bash
pg_restore -d tender_pocket tender_pocket_YYYYMMDD.dump
```

Use secure authentication.

---

# 27. Document Migration

Database migration does not automatically migrate document objects.

Verify the complete relationship:

```text
Tender record
    +
S3 object
    +
S3 object key / metadata
    =
Complete tender
```

Test representative:

- tender attachments
- technical specifications
- generated PDFs
- generated DOCX files
- generated XLSX files
- bid documents
- templates

---

# 28. Daily PostgreSQL Backup

Production requires a nightly full PostgreSQL backup stored separately from the EC2 root disk.

Required flow:

```text
PostgreSQL
    ↓
pg_dump
    ↓
Compressed backup
    ↓
Dedicated encrypted S3 backup bucket
    ↓
Retention policy
```

Recommended starting retention:

```text
30 daily backups
12 monthly backups
```

Follow the organization's approved retention policy if it is longer.

---

# 29. Implement the Backup Scheduler

Choose one approved host scheduler, such as a `systemd` timer or cron.

Example cron approach:

Create a protected backup script:

```bash
sudo mkdir -p /opt/tender-pocket/scripts
sudo nano /opt/tender-pocket/scripts/backup-postgres.sh
```

The script should:

1. create a timestamped `pg_dump`
2. verify the dump succeeded
3. upload it to the dedicated S3 backup bucket
4. verify the upload
5. remove local temporary backup files after successful upload
6. return a non-zero exit code on failure

The script must not contain hardcoded production passwords or AWS keys.

Use the EC2 IAM role for S3 access.

Schedule it once per day at 21:00 IST, before the server is stopped at 22:00 IST (section 46). A job set between 22:00 and 07:00 IST never runs. `scripts/crontab.sample` has the daily, monthly and restore-test jobs at 21:00–21:30 IST, written in UTC because Ubuntu's cron uses the server clock (UTC) and ignores `CRON_TZ`.

After enabling it, perform one manual run and verify the object exists in the backup bucket.

---

# 30. Monthly Backup Retention

At month-end:

```text
Daily backups
     ↓
Monthly retained copy
     ↓
Long-term encrypted storage
```

Do not delete daily copies until the monthly retention process has succeeded.

The exact retention period must follow the approved production policy.

---

# 31. Backup Restore Test

A backup is not considered operationally complete until restoration has been tested.

Test:

```text
Backup
  ↓
Temporary PostgreSQL restore
  ↓
Integrity checks
  ↓
Tender count check
  ↓
User check
  ↓
Representative tender check
  ↓
PASS / FAIL record
```

Perform a restore test before production go-live and periodically afterwards.

---

# 32. Monitoring

Monitor at least:

## EC2

- CPU
- memory
- disk usage
- disk I/O
- network
- instance status

## Docker

- container status
- health status
- restart count
- application logs

## PostgreSQL

- connection failures
- database size
- disk growth
- slow queries
- backup success/failure

## Application

- HTTP 5xx
- authentication failures
- S3 failures
- document-generation failures
- Gemini failures
- scheduler failures

---

# 33. Alerts

Create alerts for:

```text
EC2 unavailable
Disk > 80%
Sustained high CPU
Backend unhealthy
Frontend unavailable
PostgreSQL unhealthy
Backup missing
Backup failed
High HTTP 5xx rate
Gemini/API failure
Scheduler failure
```

Backup failure must be visible to an operator.

---

# 34. GeM Ingestion

The expected application flow is:

```text
GeM
 ↓
GeMScraperService
 ↓
Tender parsing
 ↓
PostgreSQL
 ↓
Workflow / dashboard
```

Monitor for:

- source changes
- HTTP failures
- rate limiting
- duplicates
- malformed records
- scheduler failures

Verify scheduled ingestion actually executes in production.

---

# 35. Scheduler / Background Work

For every scheduled/background job verify:

1. It starts.
2. It runs.
3. It completes.
4. Failures are logged.
5. Retry/backoff behavior works where implemented.
6. Duplicate execution does not corrupt data.

Heavy PDF/OCR/AI workloads should move toward a controlled queue/worker architecture as production scale increases.

---

# 36. Pre-Deployment Tests

Backend:

```bash
cd backend
./mvnw test
```

or:

```bash
mvn test
```

Frontend:

```bash
cd frontend
npm ci
npm run build
```

Repository checks:

```bash
git diff --check
git status
```

Before release:

- no secrets are committed
- no unintended files are tracked
- build succeeds
- tests pass
- approved commit/tag is recorded

---

# 37. Production Smoke Test

After every release, test:

## Authentication

- Admin login
- MIS Team login
- Tender Executive login
- Clearance Team login
- TPC Team login

## Dashboard

- dashboard loads
- metrics load
- tender count is correct

## Tenders

- All Tenders loads
- search works
- filters work
- detail page opens

## Authorization

- permitted action succeeds
- restricted action returns the expected authorization failure

## Documents

- existing document downloads
- S3 object is available
- generated document works

## Technical Specification / Gemini V1

If AI is enabled:

1. upload a representative technical specification/tender document
2. verify Gemini V1 is invoked
3. verify AI extraction completes
4. verify structured clauses are produced
5. verify required clause fields are populated
6. verify downstream workflow accepts the result
7. verify document generation from the resulting data
8. inspect logs for Gemini/API errors
9. verify no Azure dependency is unexpectedly required

---

# 38. Role Verification

Core roles:

```text
Admin
MIS Team
Tender Executive
Clearance Team
TPC Team
```

Verify the actual permission matrix against the current backend `WorkflowPermissions` implementation.

Do not rely only on hidden frontend buttons.

Authorization must be enforced server-side.

---

# 39. Production Release Procedure

Every release should follow this order:

```text
Code change
    ↓
Backend tests
    ↓
Frontend build
    ↓
Security review
    ↓
Approved commit/tag
    ↓
Production DB backup
    ↓
Pull exact release
    ↓
Verify commit SHA
    ↓
Build Docker images
    ↓
Start/restart application
    ↓
Health checks
    ↓
Smoke test
    ↓
Monitor
    ↓
Release sign-off
```

For an application-only release:

```bash
cd /opt/tender-pocket

git fetch --all --tags
git checkout <approved-release-tag-or-commit>

git rev-parse HEAD

docker compose build
docker compose up -d

docker compose ps
```

Do not use an arbitrary branch or uncommitted working tree for production.

---

# 40. Rollback

Before every production deployment:

1. Record the current deployed commit SHA.
2. Verify the latest database backup.
3. Record the Docker image/build state.
4. Deploy the new approved release.
5. Run health checks.
6. Run smoke tests.

If the application release fails:

```text
Stop new release
      ↓
Inspect logs
      ↓
Decide application rollback vs database recovery
      ↓
Restore previous application release if appropriate
      ↓
Verify PostgreSQL state
      ↓
Health checks
      ↓
Smoke test
```

Do not automatically restore the database merely because an application container failed.

Database restoration is a separate recovery decision.

---

# 41. Disaster Recovery

Recovery priorities:

1. Restore infrastructure/network access.
2. Restore application release.
3. Restore PostgreSQL from the latest verified backup if required.
4. Restore/verify S3 document access.
5. Verify user authentication.
6. Verify representative tenders.
7. Verify generated documents.
8. Verify Gemini V1 if AI is required.
9. Run the complete smoke test.
10. Record recovery outcome.

The backup and restore process must be practiced, not merely documented.

---

# 42. Production Security Checklist

Before go-live:

- [ ] Production-only JWT secret
- [ ] Production-only database password
- [ ] Production-only SMTP credentials
- [ ] Production-only Gemini API key
- [ ] No secrets in Git
- [ ] `.env` permissions restricted
- [ ] S3 Block Public Access enabled
- [ ] S3 encryption enabled
- [ ] EC2 IAM role attached
- [ ] No AWS access keys in `.env`
- [ ] PostgreSQL not publicly accessible
- [ ] Backend port not publicly accessible
- [ ] Frontend port not publicly accessible
- [ ] SSH restricted
- [ ] HTTPS enabled
- [ ] HTTP redirects to HTTPS
- [ ] Production CORS restricted to production domain
- [ ] PostgreSQL persistent volume verified
- [ ] Nightly backup configured
- [ ] Backup upload verified
- [ ] Restore test completed
- [ ] Monitoring enabled
- [ ] Backup alerts enabled
- [ ] AI provider verified
- [ ] SMTP verified
- [ ] GeM scheduler verified
- [ ] Role authorization verified

---

# 43. Final Production Sign-Off

Do not consider production deployment complete until all of the following are true:

```text
Infrastructure
    ✓ EC2 running
    ✓ Security group verified
    ✓ IAM role verified
    ✓ S3 document bucket verified
    ✓ S3 backup bucket verified

Application
    ✓ Backend build passed
    ✓ Frontend build passed
    ✓ Docker services running
    ✓ Backend health check passed
    ✓ Frontend health check passed
    ✓ PostgreSQL healthy

Security
    ✓ Secrets protected
    ✓ HTTPS active
    ✓ Public application ports closed
    ✓ PostgreSQL private
    ✓ Authorization verified

Data
    ✓ Database migrated/verified
    ✓ S3 documents verified
    ✓ Backup completed
    ✓ Restore test passed

Integrations
    ✓ Gemini V1 verified
    ✓ SMTP verified
    ✓ GeM ingestion verified
    ✓ Scheduled jobs verified

Validation
    ✓ Authentication smoke tests passed
    ✓ Tender workflow passed
    ✓ Document generation passed
    ✓ Technical specification AI passed
    ✓ Role authorization passed
```

Record:

```text
Production release:
Commit SHA:
Release date:
Database backup:
Backup verification:
Restore test:
AI provider:
AI model:
Production domain:
Operator:
Reviewer:
Final status:
```

---

# 44. Important Production Rules

1. Never expose PostgreSQL publicly.
2. Never expose Spring Boot port `8090` publicly.
3. Never expose Next.js port `8085` publicly in the final production architecture.
4. Never use UAT secrets in production.
5. Never commit `.env` or API keys.
6. Never use long-lived AWS keys when the EC2 IAM role is available.
7. Never run `docker compose down -v` casually in production.
8. Never deploy without a verified database backup.
9. Never call a backup successful until the backup object has been verified.
10. Never call disaster recovery ready until restoration has been tested.
11. Never assume an AI model/provider is configured merely because its environment variable exists.
12. Always verify that the deployed AI implementation is the intended `AISpecificationIntelligenceServiceV1`.
13. Always record the exact deployed commit SHA.
14. Always perform health checks and smoke tests after deployment.
15. Treat production data and documents as authoritative and protected.

---

# 45. Quick Production Command Reference

From:

```bash
cd /opt/tender-pocket
```

Check release:

```bash
git status
git rev-parse HEAD
```

Build everything:

```bash
docker compose build
```

Clean build:

```bash
docker compose build --no-cache
```

Start:

```bash
docker compose up -d
```

Check services:

```bash
docker compose ps
```

Correct Compose service names:

```text
postgres
tender-pocket-backend
tender-pocket-frontend
```

Rebuild application only:

```bash
docker compose build --no-cache tender-pocket-backend tender-pocket-frontend
```

Restart application only:

```bash
docker compose up -d tender-pocket-backend tender-pocket-frontend
```

Backend logs:

```bash
docker compose logs --tail=200 tender-pocket-backend
```

Frontend logs:

```bash
docker compose logs --tail=200 tender-pocket-frontend
```

Database logs:

```bash
docker compose logs --tail=200 postgres
```

Backend health:

```bash
curl -i http://localhost:8090/api/health
```

Frontend health:

```bash
curl -I http://localhost:8085/
```

Database verification:

```bash
docker exec tender-pocket-postgres \
  psql -U postgres -d tender_pocket \
  -c "SELECT current_database(), COUNT(*) FROM tenders;"
```

---

# 46. Office-Hours Schedule (EventBridge Scheduler)

The EC2 server runs from **07:00 to 22:00 IST** every day. Amazon EventBridge Scheduler stops it at 22:00 IST and starts it at 07:00 IST. Stopping is a normal shutdown, like pressing the power button: all data stays on the EBS disk, and the next morning the app comes back in the same state.

Set it up on the **testing EC2 first**. Keep it there for 2–3 nights, run the morning checks in 46.8 every day, and only then repeat it for the client UAT / production EC2.

## 46.1 What happens each day

| Time (IST) | What happens |
|---|---|
| 08:00, 13:00, 19:00 | Tender sync (Tender247 mails, then GeM). At 08:00 the due-date and approval alert mails are also sent. |
| 21:00–21:30 | Host backup jobs, if installed from `scripts/crontab.sample` (section 29). |
| 22:00 | Scheduler calls `StopInstances`. Ubuntu shuts down normally and Docker stops the three containers at the same time: PostgreSQL does a clean shutdown with a checkpoint (allowed up to 60 s, usually 1–2 s), the backend gives running work up to 20 s and exits (allowed up to 30 s). A save that is in progress at that moment is rolled back as a whole, never half-written. The instance becomes `stopped`. |
| 22:00–07:00 | Instance stopped. No EC2 compute charge. The EBS disk and the Elastic IP are still billed. The app cannot be opened. |
| 07:00 | Scheduler calls `StartInstances`. Ubuntu boots in about 30–60 s. Docker starts all three containers (`restart: always`). The backend waits for PostgreSQL (up to 2 minutes) and never uses SQLite. |
| about 07:01 | Catch-up sync, 15 s after the backend starts. It imports unread Tender247 mails and GeM bids from today and yesterday, so nothing published overnight is missed. |

The hourly update check (`AutoUpdateService`) only downloads and never applies an update, so it simply runs from 07:00 to 22:00.

Not merged yet: the `email-daily-digest` branch adds the 09:00 Due/Pending mails and the hourly "waiting since" refresh at :30 past each hour. Both also fit inside 07:00–22:00. When that branch is deployed, set `NOTIFY_APP_URL` in `.env` to the Elastic IP or domain.

## 46.2 What is kept when the server is stopped

| Data | Where it lives | Kept after stop/start |
|---|---|---|
| All tenders, users, approvals, comments, logs | PostgreSQL, Docker volume `postgres_data` on the EBS disk | Yes |
| Tender documents | Docker volume `backend_documents` (and S3 when enabled) | Yes |
| Company documents (frontend) | Inside the `tender-pocket-frontend` container | Yes. Stop/start keeps containers. They are lost only if the container is removed (`docker compose down`, or recreating the frontend). |
| `.env`, code, crontab | Deployment folder and host, on the EBS disk | Yes |
| Public IP | Elastic IP | Yes. Without an Elastic IP the IP would change every morning. |
| Memory: open requests, a running sync | RAM | No. Open requests finish during shutdown; a sync that is cut off is safely redone by the morning catch-up (see 46.3). |

## 46.3 Code in this release that makes the schedule safe

| Change | File | Why |
|---|---|---|
| The backend waits up to 2 minutes for PostgreSQL and never falls back to SQLite. If PostgreSQL is still down, it exits and Docker starts it again. | `backend/src/main/java/com/tenderpocket/config/DatabaseConfig.java` | At boot Docker starts all containers at once and ignores `depends_on`. Before this change, if PostgreSQL was a few seconds late, the backend silently switched to an empty SQLite file inside the container: users would see no tenders and new work would be lost. |
| The backend refuses to start if `SPRING_JPA_HIBERNATE_DDL_AUTO` is `create`, `create-drop` or `drop`. | same file | Those settings delete every table at each start, and the backend now starts every morning. Keep it `update`. |
| `stop_grace_period`: 60 s for `postgres`, 30 s for `tender-pocket-backend` | `docker-compose.yml` | Docker's default 10 s can kill PostgreSQL in the middle of its shutdown. |
| Graceful shutdown with a 20 s limit | `backend/src/main/resources/application.properties` | At 22:00 the backend stops taking new requests, gives running work up to 20 s, then closes its database connections cleanly, inside Docker's 30 s. |
| Tender247 mails are read with IMAP "peek" and marked read only after their tenders are saved. A mail that fails stays unread and is retried. | `backend/src/main/java/com/tenderpocket/services/EmailSyncService.java` | Before, a mail counted as read as soon as it was opened, so a sync cut off by the stop could lose that mail's tenders. Tenders already saved are found again, not duplicated. |
| Tender sync at fixed times: once at startup, then 08:00, 13:00, 19:00 IST | `backend/src/main/java/com/tenderpocket/scheduler/SyncScheduler.java` | The old "6 hours after the previous run" chain drifted and could start just before 22:00. A GeM sync that is cut off is still safe: a saved tender without its bid PDF gets the PDF on the next run. |
| Backup jobs at 21:00 / 21:20 / 21:30 IST, written in UTC | `scripts/crontab.sample` | Jobs set at 02:00–05:00 IST would never run while the server is off. |

## 46.4 Deploy this release on the server

Deploying recreates the `postgres` and `tender-pocket-backend` containers so the new stop timeouts apply. Data is in the volumes and is kept. The app is down for about 1–2 minutes, so do it outside working hours. Do not run `docker compose down`, and do not recreate the frontend container (it holds the company documents).

From the deployment folder (check 11 in 46.5):

```bash
git fetch
git switch <release branch>
git pull
docker compose build tender-pocket-backend
docker compose stop -t 60
docker compose up -d postgres tender-pocket-backend
docker compose start tender-pocket-frontend
docker compose ps
```

Then check that the new stop timeouts are in place:

```bash
docker inspect -f '{{.Name}} {{.HostConfig.RestartPolicy.Name}} {{.Config.StopTimeout}}' \
  tender-pocket-postgres tender-pocket-backend tender-pocket-frontend
```

Expected: `/tender-pocket-postgres always 60`, `/tender-pocket-backend always 30`, `/tender-pocket-frontend always <nil>` (Docker's default, 10 s).

## 46.5 Checks before the first scheduled stop

Run these on the server, or in AWS CloudShell for the `aws` commands. Replace `INSTANCE_ID` with the instance ID from check 1.

| # | Check | Command | Expected |
|---|---|---|---|
| 1 | Instance ID | EC2 console → Instances → select the server → **Instance ID** | `i-` followed by 17 characters |
| 2 | Root disk is EBS and the instance is not Spot | `aws ec2 describe-instances --region ap-south-1 --instance-ids INSTANCE_ID --query "Reservations[].Instances[].[RootDeviceType,InstanceLifecycle]" --output text` | `ebs` and `None` |
| 3 | Elastic IP is attached | `aws ec2 describe-addresses --region ap-south-1 --filters Name=instance-id,Values=INSTANCE_ID --query "Addresses[].PublicIp" --output text` | The IP users open (`13.232.232.54` for client UAT). Empty means no Elastic IP: allocate one and associate it first, and tell users the new address. |
| 4 | Docker starts at boot | `systemctl is-enabled docker.service containerd.service` | `enabled` twice. If not: `sudo systemctl enable docker.service containerd.service` |
| 5 | Docker stops containers when the OS shuts down | `docker info --format '{{.LiveRestoreEnabled}}'` | `false` |
| 6 | Hibernate never drops tables | `docker exec tender-pocket-backend printenv SPRING_JPA_HIBERNATE_DDL_AUTO` | `update` |
| 7 | A shutdown means "stop", never "terminate" | `aws ec2 describe-instance-attribute --region ap-south-1 --instance-id INSTANCE_ID --attribute instanceInitiatedShutdownBehavior --query InstanceInitiatedShutdownBehavior.Value --output text` | `stop` |
| 8 | Termination protection is on | `aws ec2 describe-instance-attribute --region ap-south-1 --instance-id INSTANCE_ID --attribute disableApiTermination --query DisableApiTermination.Value --output text` | `True`. If `False`: `aws ec2 modify-instance-attribute --region ap-south-1 --instance-id INSTANCE_ID --disable-api-termination` |
| 9 | No Savings Plan or Reserved Instance covers the server | `aws savingsplans describe-savings-plans --states active --query "savingsPlans[].savingsPlanId"` and `aws ec2 describe-reserved-instances --region ap-south-1 --filters Name=state,Values=active --query "ReservedInstances[].InstanceType"` | Both empty (`[]`). If not, they are billed anyway and the stop saves nothing until they end. |
| 10 | Server clock is UTC | `timedatectl` (line `Time zone`) | `Etc/UTC` (the backup cron times assume UTC) |
| 11 | Deployment folder | `docker inspect tender-pocket-backend --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}'` | The folder that holds `docker-compose.yml` and `.env` (this guide uses `/opt/tender-pocket`) |
| 12 | Encryption key of the disk | `aws ec2 describe-volumes --region ap-south-1 --filters Name=attachment.instance-id,Values=INSTANCE_ID --query "Volumes[].[Encrypted,KmsKeyId]" --output text` | Not encrypted, or the AWS managed key (`alias/aws/ebs`): nothing to do. A customer managed key: add the KMS statement in 46.6, otherwise the 07:00 start fails. |

## 46.6 IAM role for the scheduler

The scheduler uses its own role, which can only start and stop this one instance.

**Trust policy** (`scheduler-trust.json`). Replace `ACCOUNT_ID` with the 12-digit AWS account ID:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "scheduler.amazonaws.com" },
      "Action": "sts:AssumeRole",
      "Condition": { "StringEquals": { "aws:SourceAccount": "ACCOUNT_ID" } }
    }
  ]
}
```

**Permissions policy** (`scheduler-start-stop.json`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "StartStopTenderPocketServerOnly",
      "Effect": "Allow",
      "Action": ["ec2:StartInstances", "ec2:StopInstances"],
      "Resource": "arn:aws:ec2:ap-south-1:ACCOUNT_ID:instance/INSTANCE_ID"
    }
  ]
}
```

Only if check 12 found a customer managed KMS key, add this statement to the `Statement` list (replace `KEY_ID`):

```json
{
  "Sid": "UseEncryptedRootDisk",
  "Effect": "Allow",
  "Action": "kms:CreateGrant",
  "Resource": "arn:aws:kms:ap-south-1:ACCOUNT_ID:key/KEY_ID",
  "Condition": { "Bool": { "kms:GrantIsForAWSResource": "true" } }
}
```

To schedule a second server later (client UAT after testing), list both instance ARNs in `Resource`: `["arn:aws:ec2:ap-south-1:ACCOUNT_ID:instance/TESTING_ID", "arn:aws:ec2:ap-south-1:ACCOUNT_ID:instance/UAT_ID"]`.

**Console:**

1. IAM → **Roles** → **Create role**.
2. Trusted entity type: **Custom trust policy**. Paste the trust policy. **Next**.
3. Skip the permissions page. **Next**.
4. Role name: `TenderPocketEC2SchedulerRole`. **Create role**.
5. Open the role → **Add permissions** → **Create inline policy** → **JSON**. Paste the permissions policy. **Next**.
6. Policy name: `StartStopTenderPocketServer`. **Create policy**.

**CLI** (with the two JSON files in the current folder):

```bash
aws iam create-role --role-name TenderPocketEC2SchedulerRole \
  --assume-role-policy-document file://scheduler-trust.json
aws iam put-role-policy --role-name TenderPocketEC2SchedulerRole \
  --policy-name StartStopTenderPocketServer \
  --policy-document file://scheduler-start-stop.json
```

## 46.7 Create the two schedules

| | Stop schedule | Start schedule |
|---|---|---|
| Name | `tender-pocket-stop-2200-ist` | `tender-pocket-start-0700-ist` |
| Cron expression | `cron(0 22 * * ? *)` | `cron(0 7 * * ? *)` |
| Time zone | `Asia/Kolkata` | `Asia/Kolkata` |
| Flexible time window | Off | Off |
| Target (universal target) | `arn:aws:scheduler:::aws-sdk:ec2:stopInstances` | `arn:aws:scheduler:::aws-sdk:ec2:startInstances` |
| Input | `{"InstanceIds": ["INSTANCE_ID"]}` | `{"InstanceIds": ["INSTANCE_ID"]}` |
| Retry policy | Maximum age of event 30 minutes, 5 retries | Maximum age of event 30 minutes, 5 retries |
| Role | `TenderPocketEC2SchedulerRole` | `TenderPocketEC2SchedulerRole` |

Two settings matter:

- **Input has `InstanceIds` only.** Never add `Force` or `SkipOsShutdown`: the server must shut down normally so PostgreSQL stops cleanly.
- **Maximum age of event 30 minutes.** The default keeps retrying for 24 hours, so a stop that failed at 22:00 could be retried during the next working day and take the app down.

**Console** (region **Asia Pacific (Mumbai) ap-south-1**). Do this once for the stop schedule and once for the start schedule:

1. Amazon EventBridge → **Scheduler** → **Schedules** → **Create schedule**.
2. **Schedule name**: from the table. **Schedule group**: `default`.
3. **Occurrence**: Recurring schedule. **Time zone**: `(UTC+05:30) Asia/Kolkata`. **Schedule type**: Cron-based schedule.
4. **Cron expression**: minutes `0`, hours `22` (start: `7`), day of month `*`, month `*`, day of the week `?`, year `*`. Check that the next trigger dates shown are at 22:00 (start: 07:00) IST.
5. **Flexible time window**: Off. **Next**.
6. **Target detail**: **All APIs** → search `EC2` → **Amazon EC2** → **StopInstances** (start: **StartInstances**).
7. **Input**: `{"InstanceIds": ["INSTANCE_ID"]}`. **Next**.
8. **Enable schedule**: on. **Action after schedule completion**: NONE.
9. **Retry policy**: on. **Maximum age of event**: 0 hours 30 minutes. **Retry attempts**: 5. **Dead-letter queue**: None (or the queue from 46.9).
10. **Permissions**: **Use existing role** → `TenderPocketEC2SchedulerRole`. **Next**.
11. Review and **Create schedule**.

**CLI** (AWS CloudShell in ap-south-1 is easiest). Set the three values, write the two target files, then create the schedules:

```bash
REGION=ap-south-1
INSTANCE_ID=i-xxxxxxxxxxxxxxxxx
ROLE_ARN=arn:aws:iam::ACCOUNT_ID:role/TenderPocketEC2SchedulerRole

for ACTION in stop start; do
cat > "$ACTION-target.json" <<EOF
{
  "Arn": "arn:aws:scheduler:::aws-sdk:ec2:${ACTION}Instances",
  "RoleArn": "$ROLE_ARN",
  "Input": "{\"InstanceIds\":[\"$INSTANCE_ID\"]}",
  "RetryPolicy": { "MaximumEventAgeInSeconds": 1800, "MaximumRetryAttempts": 5 }
}
EOF
done

aws scheduler create-schedule --region "$REGION" \
  --name tender-pocket-stop-2200-ist \
  --description "Stop the TenderPocket EC2 at 22:00 IST" \
  --schedule-expression "cron(0 22 * * ? *)" \
  --schedule-expression-timezone Asia/Kolkata \
  --flexible-time-window Mode=OFF \
  --target file://stop-target.json \
  --state ENABLED

aws scheduler create-schedule --region "$REGION" \
  --name tender-pocket-start-0700-ist \
  --description "Start the TenderPocket EC2 at 07:00 IST" \
  --schedule-expression "cron(0 7 * * ? *)" \
  --schedule-expression-timezone Asia/Kolkata \
  --flexible-time-window Mode=OFF \
  --target file://start-target.json \
  --state ENABLED

aws scheduler list-schedules --region "$REGION" --name-prefix tender-pocket \
  --query "Schedules[].[Name,State]" --output table
```

## 46.8 Test it

**Day 0: a daytime dry run on the testing EC2.** One-time schedules run the full stop and start in about 15 minutes, so you do not have to wait for the night.

1. On the server, save the current state:

   ```bash
   cd ~
   docker exec tender-pocket-postgres psql -U postgres -d tender_pocket -At \
     -c "SELECT id FROM tenders" | sort > tender-ids-before.txt
   docker exec tender-pocket-postgres psql -U postgres -d tender_pocket -At -c "
     SELECT 'tenders', COUNT(*) FROM tenders UNION ALL
     SELECT 'users', COUNT(*) FROM users UNION ALL
     SELECT 'approval requests', COUNT(*) FROM tender_approval_requests UNION ALL
     SELECT 'workflow states', COUNT(*) FROM tender_workflow_states UNION ALL
     SELECT 'workflow comments', COUNT(*) FROM tender_workflow_comments UNION ALL
     SELECT 'status history', COUNT(*) FROM status_history UNION ALL
     SELECT 'activity log', COUNT(*) FROM activity_log" > counts-before.txt
   cat counts-before.txt
   ```

2. In CloudShell, using the target files from 46.7, create a stop about 10 minutes from now and a start 5 minutes after it. Write the times in IST as `yyyy-mm-ddThh:mm:ss`:

   ```bash
   aws scheduler create-schedule --region ap-south-1 --name tender-pocket-test-stop \
     --schedule-expression "at(2026-11-17T15:00:00)" --schedule-expression-timezone Asia/Kolkata \
     --flexible-time-window Mode=OFF --target file://stop-target.json --action-after-completion DELETE
   aws scheduler create-schedule --region ap-south-1 --name tender-pocket-test-start \
     --schedule-expression "at(2026-11-17T15:05:00)" --schedule-expression-timezone Asia/Kolkata \
     --flexible-time-window Mode=OFF --target file://start-target.json --action-after-completion DELETE
   ```

3. Watch EC2 console → Instances: `running` → `stopping` → `stopped`, then `pending` → `running`. The test schedules delete themselves after they run.
4. About 2 minutes after the start, run the morning checks below.

**Nights 1–3:** create the recurring schedules (46.7). Save the "before" files from step 1 at about 21:50, and run the morning checks every day at about 07:15.

**Morning checks:**

| # | Check | How | Expected |
|---|---|---|---|
| 1 | The scheduler stopped and started the server | CloudTrail → **Event history** → Event name `StopInstances`, then `StartInstances` | One of each, at 22:00:xx and 07:00:xx IST. **User name** is a `TenderPocketEC2SchedulerRole` session. |
| 2 | Server is up | EC2 console → Instances | `Running`, status checks passed, same Elastic IP |
| 3 | All containers are up | `docker ps --format '{{.Names}}  {{.Status}}'` | 3 containers `Up`, backend `(healthy)` |
| 4 | PostgreSQL shut down cleanly | `docker logs --since 12h tender-pocket-postgres 2>&1 \| grep -E "shut down\|interrupted\|redo starts"` | `database system was shut down at …`. Not `was interrupted` or `redo starts`: those mean PostgreSQL was killed and recovered. The data is still safe, but report it. |
| 5 | Backend is on PostgreSQL, not SQLite | `docker logs --since 1h tender-pocket-backend 2>&1 \| grep -F "[DatabaseConfig]"` | `Configured PostgreSQL DataSource successfully`, maybe after a few `PostgreSQL is not ready yet` lines. Never `Configured SQLite DataSource` or `Falling back to SQLite` (the old code). The `[Database Migration] … normalized SQLite timestamps` line is normal. |
| 6 | Backend is healthy | `docker exec tender-pocket-backend wget -qO- http://localhost:8090/api/health` | `status` `UP` and `database` `UP` |
| 7 | Catch-up sync ran | `docker logs --since 1h tender-pocket-backend 2>&1 \| grep -F "[Scheduler]"` | `Running startup catch-up Tender sync...`, then `Email Sync completed` and `GeM Sync completed` |
| 8 | No tender lost | `docker exec tender-pocket-postgres psql -U postgres -d tender_pocket -At -c "SELECT id FROM tenders" \| sort > tender-ids-after.txt` then `comm -23 tender-ids-before.txt tender-ids-after.txt` | Prints nothing: every tender ID from before is still there. |
| 9 | Counts | Run the counts query from step 1 again and compare with `counts-before.txt` | Equal or higher (the catch-up sync and users add rows), never lower |
| 10 | App works | Open `http://<Elastic IP>:8085`, log in, open a few tenders and documents | Same data as the evening before |
| 11 | Mails | 08:00 alert mails | Arrive as before |

After a few days, open **Billing → Cost Explorer**: service EC2-Instances, granularity Daily, group by Usage type. `BoxUsage:m7i.large` should be about 15 hours a day instead of 24.

## 46.9 Alerts (recommended)

**Email when the server stops or starts.** If the "running" mail is missing in the morning, the start failed.

1. SNS → **Topics** → **Create topic** → Standard → name `tender-pocket-alerts` → **Create topic**. Then **Create subscription** → Protocol **Email** → your address, and confirm the mail AWS sends.
2. EventBridge → **Rules** → **Create rule** → name `tender-pocket-ec2-state` → **Rule with an event pattern** → **Custom pattern (JSON editor)**:

   ```json
   {
     "source": ["aws.ec2"],
     "detail-type": ["EC2 Instance State-change Notification"],
     "detail": {
       "state": ["running", "stopped"],
       "instance-id": ["INSTANCE_ID"]
     }
   }
   ```

3. Target: **SNS topic** → `tender-pocket-alerts` → **Create rule**.

**Failed scheduler calls (optional).** Create an SQS queue `tender-pocket-scheduler-dlq`, choose it as the **Dead-letter queue** of both schedules (46.7 step 9), and add a CloudWatch alarm on the queue's `ApproximateNumberOfMessagesVisible` ≥ 1 that notifies `tender-pocket-alerts`.

## 46.10 Pause, undo, or start the server at night

| Need | Do |
|---|---|
| Server needed at night once | EC2 console → Instances → **Instance state** → **Start**. It runs until the next 22:00 stop. |
| Server needed past 22:00 tonight | EventBridge → Scheduler → Schedules → `tender-pocket-stop-2200-ist` → **Disable**. **Enable** it again the next day. |
| Stop using the schedule | **Disable** both schedules, or delete them with `aws scheduler delete-schedule --region ap-south-1 --name <name>`. Start the instance if it is stopped. The app then runs 24/7 as before; the code changes in 46.3 work for that too. |

Costs (from the cost report): on-demand m7i.large in Mumbai is $0.1061/hour, so the 9 stopped hours save about $29 a month. The EBS disk and the Elastic IP are billed all the time, and the scheduler stays inside the free tier.

---


## Production principle

The production deployment should be:

```text
Immutable approved release
        ↓
Encrypted infrastructure
        ↓
Private database
        ↓
Private S3 documents
        ↓
Dedicated encrypted backups
        ↓
Gemini V1 for technical intelligence
        ↓
HTTPS public entry point
        ↓
Health checks
        ↓
Smoke tests
        ↓
Monitoring + recovery
```

This is the required operating model for a repeatable Tender Pocket production deployment.
