# Tender Pocket

Spring Boot application for tracking Government e-Marketplace (GEM) tenders — auto-syncs new tenders, scrapes tender-alert emails, uses Gemini AI to extract and summarize tender specifications from PDFs, and serves a bundled React SPA for browsing/managing them.

This is a single deployable unit: the frontend is a pre-built static SPA (`public/`) served directly by Spring Boot, so there is no separate frontend server to run.

## Stack

- **Backend:** Spring Boot 3.4.1, Java 21
- **Database:** PostgreSQL (JPA/Hibernate, `ddl-auto=update` — no separate migration step)
- **Frontend:** Pre-built React SPA, served as static files from `public/`
- **AI:** Google Gemini API (document/PDF summarization)
- **OCR:** Tesseract (for scanned specification PDFs)
- **Email:** IMAP scraping (Gmail) for tender alert emails + SMTP for outbound alerts
- **Auth:** JWT

---

## Prerequisites

- **Java 21** (not 25 — Spring Boot 3.4.1 + Lombok require 21)
- **Maven** (or use the bundled `./mvnw` if present)
- **PostgreSQL 16+** running locally
- **Tesseract OCR** — required for scanned PDF extraction:
  ```bash
  # macOS
  brew install tesseract
  ```
  (In Docker this is installed automatically — see `Dockerfile`.)

---

## 1. Database setup

```bash
createdb tender_pocket
```

No manual migration step needed — Hibernate creates/updates tables automatically on first run (`spring.jpa.hibernate.ddl-auto=update` in `application.properties`), plus a small startup routine widens a few columns to `TEXT`.

---

## 2. Configure environment variables

The app reads sane localhost defaults out of the box, but for real functionality set:

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 21)   # macOS

# Database (defaults to localhost:5432/tender_pocket with your system user)
export SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:5432/tender_pocket
export SPRING_DATASOURCE_USERNAME=postgres
export SPRING_DATASOURCE_PASSWORD=

# Gemini AI (required for document summarization / spec extraction)
export GEMINI_API_KEY=your_gemini_api_key

# Gmail SMTP (for outbound tender alerts) — use a Gmail App Password, not your account password
export SPRING_MAIL_USERNAME=your_email@gmail.com
export SPRING_MAIL_PASSWORD=your_16_char_app_password

# IMAP (for scraping inbound tender alert emails)
export IMAP_USERNAME=your_email@gmail.com
export IMAP_PASSWORD=your_16_char_app_password
export IMAP_SENDER_FILTER=sender_to_watch@example.com
```

Gmail App Password setup: enable 2-step verification on the account, then generate one at https://myaccount.google.com/apppasswords.

Leaving `GEMINI_API_KEY` / mail vars unset won't crash the app — those features will just no-op or fail gracefully when triggered.

---

## 3. Run the app

```bash
cd tender-pocket-spring-workflow   # or wherever you cloned it
mvn spring-boot:run
```

Or build + run the jar directly:
```bash
mvn package -DskipTests
java -jar target/tender-pocket-spring-0.0.1-SNAPSHOT.jar
```

Open **http://localhost:8080** — this serves both the API (`/api/...`) and the bundled frontend SPA in one process.

---

## 4. Run with Docker instead

```bash
export GEMINI_API_KEY=your_gemini_api_key
docker-compose up --build
```

Runs on **http://localhost:8080**. Note: `docker-compose.yml` as checked in mounts a SQLite file (`./tenders.db`) for legacy compat, but the app is configured for PostgreSQL by default — point `SPRING_DATASOURCE_URL` at a reachable Postgres instance (e.g. `host.docker.internal` on macOS to reach your local Postgres from inside the container).

---

## Key features / routes

| Controller | Purpose |
|---|---|
| `AuthController` | JWT login/session |
| `TenderController` | CRUD + listing for tenders |
| `AnalyticsController` | Dashboard/analytics endpoints |
| `ActivityLogController` | Audit trail of actions on tenders |
| `UpdateController` | Self-update mechanism (checks `cavipulvbhandari/tender-pocket-spring-workflow` on GitHub) |
| `SpaForwardController` | Forwards deep-link routes (e.g. `/tenders/{id}`) to `index.html` so client-side routing works on refresh |

Scheduled jobs (`@EnableScheduling`) handle periodic GEM portal sync and email scraping — see `scripts/cron-sync-gem.sh` and `scripts/sync-emails.js` for the equivalent standalone scripts used during development.

---

## Deployment

Configured for **Render** (`render.yaml`) using the multi-stage `Dockerfile`. Required secrets to set in Render's dashboard (marked `sync: false` in `render.yaml`): `SPRING_MAIL_USERNAME`, `SPRING_MAIL_PASSWORD`, `IMAP_USERNAME`, `IMAP_PASSWORD`, `GEMINI_API_KEY`.

## Utility scripts

`scripts/` contains standalone Node/Python/TS scripts used for development and debugging (PDF parsing tests, GEM portal scraping experiments, email parsing tests, link verification, etc.) — not part of the running application, safe to ignore unless actively debugging a specific integration.
