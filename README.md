# Tender Pocket — Full-Stack Monorepo

This repository contains the complete full-stack codebase for **Tender Pocket**, including the React Next.js frontend source and the Java Spring Boot backend service.

---

## 📁 Repository Structure

* **`frontend/`**: Next.js & React source code
  * `frontend/src/app/page.tsx`: Main Dashboard & Workflow Drawer UI
  * `frontend/src/app/tenders/[id]/page.tsx`: Full-Screen Tender Route Component
  * `frontend/src/app/globals.css`: Global Styles & Responsive Drawer CSS
  * `frontend/src/lib/db.ts`: TypeScript Database Schemas & Types
* **`backend/`**: Java Spring Boot backend & scraper services
  * `backend/src/main/java/com/tenderpocket/controllers/`: REST API Controllers
  * `backend/src/main/java/com/tenderpocket/services/GeMScraperService.java`: GeM Portal Scraper Engine
  * `backend/src/main/java/com/tenderpocket/services/DocumentGeneratorService.java`: PDF/DOCX Document Compilation Engine
  * `backend/tenders.db`: SQLite database containing 1,194 tender records

---

## 🚀 How to Run

### 1. Running the Spring Boot Backend (Port 8080)
```bash
cd backend
mvn clean package -DskipTests
java -jar target/tender-pocket-spring-0.0.1-SNAPSHOT.jar
```

### 2. Running the Next.js Frontend Development Server
```bash
cd frontend
npm install
npm run dev
```
