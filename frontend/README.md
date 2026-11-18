# TenderPocket — Frontend (Next.js)

The React / Next.js frontend application for TenderPocket, running on default port **8085**.

## 🚀 Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env.local
   ```
   *(On Windows PowerShell: `Copy-Item .env.example .env.local`)*

3. **Start development server (Port 8085):**
   ```bash
   npm run dev
   ```

4. **Open your browser:**
   Navigate to [http://localhost:8085](http://localhost:8085)

## ⚙️ Port Configuration

- **Default Port**: `8085` (configured in `package.json` scripts)
- **Override dynamically**:
  ```bash
  npm run dev -- -p 8086
  # or
  PORT=8086 npm run dev
  ```

## 🛠️ Architecture & Features

- **Framework**: Next.js 16 (App Router), React 19, Tailwind CSS 4
- **Local Persistence**: Built-in SQLite (`tenders.db`) via `better-sqlite3` with dynamic schema migrations
- **Spring Boot Proxying**: Automatically proxies requests to the Spring Boot backend (`http://localhost:8090` by default) when available
- **Role-Based Views**: Executive, Clearance Team, Brochure Team, TPC Team, MIS Team, and Admin (the Approvals Center serves Clearance, TPC, MIS and Admin; the Brochure Team uploads brochures on the tender page)

