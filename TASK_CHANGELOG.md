# TenderPocket — Detailed Engineering Changelog & Task History

This document provides a comprehensive chronological record of all architectural, operational, and code changes implemented in the TenderPocket codebase from project inception through production readiness.

---

## 📋 Executive Summary

TenderPocket was transformed from a preliminary tender tracking prototype into an enterprise-grade GeM (Government e-Marketplace) workflow automation system. The system now features a robust 8-stage sequential lifecycle, an integrated multi-department Approvals Center, strict commercial confidentiality safeguards, and automated document compilation.

### Key Milestones Achieved:
1. **Approvals Center Architecture**: Centralized cross-department workflow hub handling 6 approval stages with request deduplication and bidirectional database sync.
2. **Clearance Team Integration**: Dedicated technical specification clearance queue with document viewer, approval gating, and structured rejection feedback.
3. **TPC Pricing Team Integration**: Dedicated manufacturer pricing queue with zero-leakage commercial confidentiality (`tpc_purchase_price` masked from Executives).
4. **Role-Specific Dashboards**: Custom viewports, metrics, and actionable queues tailored for Executive, Clearance, TPC, MIS Team, and Admin roles.
5. **Sequential Workflow Corrections**: Resolved the "Docs Prep Skipped" defect by separating MIS price setting from document compilation, reordering workflow cards, and establishing strict gating on bid document generation and EMD payment release.
6. **Bid Document Compilation Engine**: Automated generation of Word DOCX and PDF bid packs (MAF, Undertakings, Compliance sheets).
7. **20-Point Automated Test Suite**: Production verification suite covering happy paths, rejection loops, request deduplication, and role security boundaries with 100% pass rate.

---

## 🏛️ Phase 1: Approvals Center Architecture & Infrastructure

### 1. Database Schema Extensions
- **SQLite (`frontend/src/lib/db.ts`)**:
  - Created `tender_approvals` table tracking `tender_id`, `stage`, `requested_by`, `assigned_role`, `status` (`PENDING`, `APPROVED`, `REJECTED`, `CHANGES_REQUESTED`), `decision_notes`, `reviewed_by`, `reviewed_at`, and `created_at`.
  - Added indexes on `tender_id`, `stage`, `status`, and `assigned_role` for fast dashboard queries.
  - Added automatic schema migrations ensuring existing databases seamlessly upgrade without data loss.
- **PostgreSQL / Spring Boot JPA (`backend/src/main/java/com/tenderpocket/models/TenderApproval.java`)**:
  - Defined `TenderApproval` entity mapped to `tender_approvals` table with JPA annotations.
  - Created `TenderApprovalRepository.java` providing custom query methods:
    - `findByStatusAndStageInOrderByCreatedAtDesc`
    - `countByStatusAndStageIn`
    - Aggregation queries for status summaries.

### 2. Dedicated REST API Endpoints
- **Frontend App Router API (`frontend/src/app/api/approvals/`)**:
  - `GET /api/approvals`: Retrieves approval queues filtered by role, stage, and status with pagination.
  - `GET /api/approvals/stats`: Aggregates real-time pending counts across all workflow stages for badge display.
  - `POST /api/approvals/[id]/review`: Executes role-validated reviews (`APPROVED`, `REJECTED`, `CHANGES_REQUESTED`) with mandatory comments and stage updates.
- **Backend Spring Boot Controller (`backend/src/main/java/com/tenderpocket/controllers/ApprovalController.java`)**:
  - Implemented `/api/approvals` endpoints in Spring Boot with token-derived security context (`SecurityContextHolder`).
  - Added support for role-based filtering, stage reconciliation, and audit log generation.

### 3. Unified Approvals Drawer UI Component
- Created `frontend/src/app/components/ApprovalsDrawer.tsx`:
  - Slide-out drawer accessible from any page via navigation bar badge.
  - Tabbed filtering: "All", "Specification", "TPC Pricing", "MIS Pricing", "Doc Verification", "Payments", "Submissions".
  - Stage-specific badge counters showing pending item counts.
  - Interactive Review Dialog: Allows approving, rejecting, or requesting revisions with mandatory feedback notes.
  - Direct deep-links into the tender workspace.

### 4. Request Deduplication & Uniqueness Engine
- Created `frontend/src/lib/approvalsSync.ts`:
  - Implemented `reconcileApprovalRequests(tenderId, stage, requestedBy)`:
    - Checks whether an active `PENDING` approval request already exists for the given tender and stage.
    - If found, updates the existing request with latest timestamp and notes rather than creating duplicate records.
    - Prevents clutter and conflicting reviews across multiple submissions.

---

## 🔬 Phase 2: Clearance Team Role & Specification Review Queue

### 1. Role Architecture & Provisioning
- Introduced the `Clearance Team` (alias `Specification Team`) role.
- Seeded default test account: `clearance` (password from `CLEARANCE_DEFAULT_PASSWORD`).
- Updated authentication validators in both frontend (`lib/auth.ts`) and backend (`JwtRequestFilter.java`, `ApprovalController.java`).

### 2. Specification Upload & Request Pipeline
- Built `POST /api/tenders/[id]/upload-tech-spec`:
  - Accepts multipart technical specifications (PDF, DOCX, XLSX, images).
  - Stores uploaded documents in `frontend/public/documents/[tenderId]/specifications/`.
  - Updates tender's `tech_spec_url` and `tech_spec_status = 'UPLOADED'`.
- Built `POST /api/tenders/[id]/clearance-request`:
  - Initiates specification clearance workflow.
  - Updates tender stage to `CLEARANCE_PENDING`.
  - Creates/updates deduplicated approval request assigned to `Clearance Team`.

### 3. Clearance Review & Feedback Loops
- Built `POST /api/tenders/[id]/approve-clearance`:
  - Authorized exclusively for `Clearance Team`, `Specification Team`, and `Admin`.
  - **Approval**: Sets `tech_spec_status = 'APPROVED'`, advances tender stage to `TPC_PRICING`, and creates approval record for TPC Team.
  - **Rejection**: Sets `tech_spec_status = 'REJECTED'`, moves tender back to `DRAFT` / `SPEC_REJECTED`, and logs detailed rework feedback for the Tender Executive.
- Fixed permission checks in `frontend/src/app/api/approvals/[id]/review/route.ts` and `backend/src/main/java/com/tenderpocket/controllers/ApprovalController.java` to explicitly permit Clearance Team members to execute reviews.

---

## 💰 Phase 3: TPC Pricing Team & Commercial Confidentiality

### 1. Role Architecture & Provisioning
- Introduced the `TPC Pricing Team` (`TPC Team`) role.
- Seeded default test account: `tpc` (password from `TPC_DEFAULT_PASSWORD`).
- Dedicated workflow responsibility: contacting OEMs, evaluating technical equipment costs, and submitting manufacturer purchase quotes.

### 2. TPC Pricing Submission Pipeline
- Built `POST /api/tenders/[id]/tpc-price`:
  - Captures `tpc_purchase_price`, `tpc_quote_reference`, `tpc_vendor_name`, and manufacturer warranty/delivery notes.
  - Advances tender stage to `MIS_PRICING`.
  - Automatically raises approval request assigned to `MIS Team`.

### 3. Commercial Confidentiality & Data Redaction Architecture
- **Problem**: In government contracting, manufacturer purchase prices and internal margins must remain strictly confidential from front-line tender executives to prevent unauthorized disclosure.
- **Solution**: Implemented field-level redaction at the API gateway layer:
  - In `frontend/src/app/api/tenders/[id]/route.ts`:
    ```typescript
    if (userRole === 'Tender Executive' || userRole === 'Executive') {
      delete tender.tpc_purchase_price;
      delete tender.tpc_vendor_name;
    }
    ```
  - In `frontend/src/app/api/tenders/route.ts`:
    - Iterates across tender arrays and strips `tpc_purchase_price` before returning list views.
  - Front-end UI conditionally renders the TPC Price card only for authorized management roles (TPC, MIS, Admin).

---

## 📊 Phase 4: Role-Specific Dashboards & Dynamic UI Rendering

### 1. Dynamic Role Switcher & Viewports
Refactored `frontend/src/app/page.tsx` to provide tailored workspaces based on the authenticated user's role:

- **Tender Executive Dashboard**:
  - Highlights tenders requiring specification uploads.
  - Quick-filters for tenders cleared by MIS that are ready for Bid Document compilation.
  - Hides confidential vendor pricing fields.
- **Clearance Team Dashboard**:
  - Displays pending technical specifications awaiting clearance review.
  - Direct document preview modal for uploaded spec sheets.
  - One-click approve/reject actions with comment prompts.
- **TPC Pricing Team Dashboard**:
  - Filters tenders that have achieved Technical Specification clearance.
  - Dedicated pricing entry dialog for manufacturer purchase quotes and OEM notes.
- **MIS Team Dashboard (Control Tower)**:
  - Central operational view monitoring the entire pipeline.
  - Shows TPC quoted prices side-by-side with proposed selling prices.
  - Document verification queue for generated bid packs.
  - EMD payment authorization and release desk.
  - GeM portal submission confirmation and post-bid outcome tracker.
- **Admin Dashboard**:
  - Comprehensive access to all department queues.
  - System audit trails, user account creation, password management, and emergency stage overrides.

---

## ⚙️ Phase 5: Sequential Workflow Corrections & Gating Bug Fixes

### 1. Root-Cause Analysis: The "Docs Prep Skipped" Defect
- **Identified Defect**:
  - In earlier iterations, entering the MIS selling price in the UI immediately completed the tender preparation phase or attempted to trigger bid document generation automatically.
  - As a result, the Tender Executive's document preparation step ("Docs Prep") was bypassed, preventing executives from attaching required vendor declarations, compliance certificates, and reviewing compiled packs.
  - Additionally, document compilation could be called prematurely when specifications were still pending clearance.

### 2. Systematic Workflow Corrections
1. **Decoupled Pricing from Generation**:
   - Updated `POST /api/tenders/[id]/mis-price`: Submitting the final MIS price now cleanly transitions the tender to `BID_DOC_PENDING` (Docs Prep stage). It does NOT advance to EMD payment or mark preparation as complete.
2. **Reordered Workflow Progression Cards**:
   - Re-architected `frontend/src/app/tenders/[id]/page.tsx` stepper and action cards:
     - Card 1: Technical Specification Clearance (`Clearance Team`)
     - Card 2: TPC Manufacturer Pricing (`TPC Team`)
     - Card 3: MIS Pricing (`MIS Team`)
     - Card 4: **Docs Prep — Bid Document Generation** (`Tender Executive`)
     - Card 5: **Document Verification & Clearance** (`MIS Team`)
     - Card 6: EMD / Security Deposit Payment (`MIS Team`)
     - Card 7: GeM Portal Submission (`MIS Team`)
     - Card 8: Outcome & Post-Bid Analysis (`MIS Team`)
3. **Precondition Gating in `generate-bid-docs`**:
   - Updated `frontend/src/app/api/tenders/[id]/generate-bid-docs/route.ts`:
     - Checks `tender.tech_spec_status === 'APPROVED'`. If not, returns `400 Bad Request: "Technical specifications must be approved before generating bid documents"`.
     - Checks `tender.mis_final_price > 0`. If not, returns `400 Bad Request: "MIS final selling price must be set before generating bid documents"`.
4. **Document Verification Stage (`DOC_VERIFICATION`)**:
   - After Executive generates bid documents, an approval request is automatically created for the `MIS Team` (`DOC_VERIFICATION`).
   - MIS Team inspects compiled DOCX/PDF files and verifies compliance.
5. **Strict EMD Payment Gating**:
   - Updated the EMD Payment component to enforce a strict prerequisite check: EMD Payment is disabled and locked until `doc_clearance_status === 'APPROVED'`.

---

## 📑 Phase 6: Document Compilation, Templating & Preview Engine

### 1. DOCX Template Engine
- Utilized the `docx` library in `frontend/src/app/api/tenders/[id]/generate-bid-docs/route.ts` to generate formal GeM tender documentation:
  - **Manufacturer Authorization Form (MAF)**: Formats OEM details, tender reference, authorized distributor declaration, and equipment warranty commitments.
  - **Undertaking & Non-Blacklisting Declaration**: Legal undertaking affirming non-debarment, compliance with GeM general terms and conditions, and authenticity of submitted documents.
  - **Technical Compliance Sheet**: Itemized matrix comparing required tender specifications with offered OEM specifications.
  - **Commercial Bid Summary**: Itemized price breakup with approved MIS selling price and taxes.

### 2. PDF Rendering & Storage
- Compiled documents are stored in structured directories: `frontend/public/documents/[tenderId]/generated/`.
- Generated files include unique timestamps and checksums to ensure document authenticity.
- Built an integrated in-app PDF preview modal allowing executives and MIS reviewers to inspect compiled documents without downloading external viewers.

---

## 🧪 Phase 7: Automated Verification Suite & Quality Assurance

### 1. Test Suite Architecture (`frontend/scripts/test-complete-workflow-suite.js`)
Constructed an automated 20-point test runner validating the full end-to-end lifecycle, error branches, deduplication, and role security boundaries.

### 2. Verified Test Coverage
- **Section 1: Happy Path (8 Sequential Stages)**:
  - `Test 1`: Fresh Tender Discovery & Spec Upload (`CLEARANCE_PENDING`)
  - `Test 2`: Clearance Team Spec Review & Approval &rarr; Stage moves to `TPC_PRICING`
  - `Test 3`: TPC Team Purchase Price Input &rarr; Stage moves to `MIS_PRICING`
  - `Test 4`: MIS Team Final Price Input &rarr; Stage moves to `BID_DOC_PENDING` (Docs Prep)
  - `Test 5`: Gating Enforcement &rarr; Premature doc generation blocked
  - `Test 6`: Executive Bid Pack Compilation (DOCX & PDF generated)
  - `Test 7`: MIS Team Document Verification & Approval &rarr; Stage moves to `PAYMENT_PENDING`
  - `Test 8`: MIS Team EMD Payment Verification &rarr; Stage moves to `SUBMISSION_PENDING`
  - `Test 9`: GeM Portal Final Submission &rarr; Stage moves to `SUBMITTED`
  - `Test 10`: Post-Bid Outcome Evaluation &rarr; Stage moves to `WON`
- **Section 2: Rejection Handling & Feedback Loops**:
  - `Test 11`: Specification Clearance Rejection & Rework Feedback
  - `Test 12`: Document Verification Rejection & Revision Notes
  - `Test 13`: EMD Payment Rejection & Correction Loop
  - `Test 14`: Submission Verification Rejection & Correction Loop
  - `Test 15`: Bid Outcome Lost with Mandatory Reason & Competitor L1 Data
- **Section 3: Request Deduplication & Uniqueness**:
  - `Test 16`: Consecutive clearance submissions update existing pending approval
  - `Test 17`: Resubmission after rejection cleanly updates the existing approval
- **Section 4: Cross-Role Security & Commercial Confidentiality**:
  - `Test 18`: `tpc_purchase_price` is strictly masked from Tender Executive responses
  - `Test 19`: Tender Executive cannot review approvals (403 Forbidden enforced)
  - `Test 20`: Clearance Team reviews Spec; TPC Team reviews Pricing

### 3. Test Execution Summary
- **Total Tests Executed**: 20
- **Passed**: 20
- **Failed**: 0
- **Success Rate**: **100.0%**

---

## 📦 Phase 8: Production Build & Repository Hygiene

### 1. Production Compilation Verification
- **Frontend Build**:
  - Command: `npm run build --prefix frontend`
  - Result: Compiled cleanly with **0 TypeScript errors, 0 ESLint errors** across all 18 routes.
- **Backend Build**:
  - Command: `mvn clean compile -f backend/pom.xml`
  - Result: `BUILD SUCCESS` across all 42 source files.

### 2. Git Hygiene (`.gitignore`)
- Updated root `.gitignore` to prevent generated artifacts and scratch files from entering version control:
  - `frontend/public/documents/`
  - `scratch/`
  - `*.tmp`, `*.temp`
  - `.tempmediaStorage/`
  - `*.db`, `tenders.db`

---

## 🔧 Phase 9: Approvals Center Bid Documents (`DOC_VERIFICATION`) Approval Fix

### 1. Issue Analysis & Root Cause
- **Reported Defect**: Bid documents were successfully generated and routed to the MIS Team, but clicking "Confirm Approve" from the Approvals Center did not approve the tender. However, approving from the tender detail workspace did work.
- **Root Cause Identified**:
  1. **Premature Forwarding / Early Return Bypass in `review/route.ts`**: The review endpoint proxied the request to the Spring Boot backend (`http://localhost:8090`). If backend returned a 200 OK, the route returned immediately without updating the authoritative local SQLite database (`frontend/tenders.db`), leaving SQLite's tender state unchanged.
  2. **False "Stale" Reconcile Trap in Spring Boot & SQLite**: Both backend `ApprovalController.java` and frontend `approvalsSync.ts` used `WHERE verification_status != 'Pending'` to auto-mark requests as `APPROVED`. When a tender was newly created with `verification_status = 'None'`, the reconciler prematurely marked the approval request as `APPROVED`. Thus, when the MIS Team submitted the review, the backend returned `"This approval request has already been completed."` without updating the tender.
  3. **Missing Status Setter in Spring Boot**: `ApprovalController.java` advanced `currentStage` to `PAYMENT_APPROVAL` but omitted setting `tender.setVerificationStatus("Approved")`.
  4. **Omitted `current_stage` in `PATCH /api/tenders/[id]`**: Destructuring and update lists lacked `current_stage`, meaning `updateTenderField` did not reliably persist stage changes unless explicitly triggered.

### 2. Systematic Corrections Implemented
1. **Authoritative SQLite Execution in `review/route.ts`**:
   - Ensured the local SQLite transaction always executes first: marks the approval request as `APPROVED`, sets `verification_status = 'Approved'`, advances `current_stage = 'PAYMENT_APPROVAL'`, and automatically creates the next pending approval request for `PAYMENT_APPROVAL`.
   - Replaced fragile premature return with robust background synchronization to Spring Boot.
   - Added safeguard ensuring that if an approval request was marked approved but the tender was not yet updated, the tender is unconditionally brought to the approved state.
2. **Accurate Reconciliation Logic**:
   - Fixed `approvalsSync.ts` and `ApprovalController.java` to check `verification_status = 'Approved'` (and `payment_status = 'Approved'`, `submission_status = 'Approved'`) rather than `!= 'Pending'`.
3. **Spring Boot `ApprovalController.java`**:
   - Set `tender.setVerificationStatus("Approved")` on `DOC_VERIFICATION` approval.
   - Set `tender.setPaymentStatus("Approved")` on `PAYMENT_APPROVAL` approval.
   - Set `tender.setSpecVerificationStatus("Approved")` on `SPEC_CLEARANCE` approval.
   - Set `currentStage` to `BID_DOC_PENDING` on `MIS_PRICING` approval.
4. **`PATCH /api/tenders/[id]/route.ts`**:
   - Added `current_stage` to destructuring and allowed update parameters.
   - Auto-advanced stages upon `verification_status = 'Approved'` and `payment_status = 'Approved'`.
5. **Automated Verification**:
   - Created `frontend/scripts/test-approvals-center-doc-review.js` simulating the exact user flow (generating docs as Executive & approving via Approvals Center as MIS Team).
   - Test verified 100% successful with status moving to `PAYMENT_APPROVAL`, `verification_status: 'Approved'`, and unlocking EMD payment.

---

## 🛡️ Phase 10: Senior Review Resolution & Security Hardening

### 1. Issues Identified in Review
1. **Backend Role Extraction Defense-in-Depth**: Pre-existing Spring Boot controllers relied on unverified `@RequestHeader("x-user-role")`.
2. **Team Queue Ownership Safeguard**: `ApprovalController.java` rejected non-admin reviews if `assignedTo` was `misteam`, `clearance`, or `tpc` instead of individual usernames.
3. **Frontend Header Fallback Whitelisting**: `auth.ts` allowed unverified header fallback without role validation or a production strict-mode toggle.
4. **Endpoint Route Security**: `PATCH` and `DELETE` in `api/tenders/[id]` and `POST` in `generate-bid-docs` relied on raw headers without cryptographic JWT verification or role checks.

### 2. Solutions Implemented & Verified
1. **Spring Boot Cryptographic Role Resolution (`resolveUserRole` / `resolveUsername`)**:
   - Added `resolveUserRole()` and `resolveUsername()` to `TenderController.java` and `WorkflowController.java`.
   - Prioritizes cryptographically verified claims from `SecurityContextHolder` (populated by `JwtRequestFilter` from the bearer token) before checking headers.
2. **Team Queue Support in `ApprovalController.java`**:
   - Updated ownership validation to permit authorized team queue aliases (`misteam`, `mis team`, `clearance`, `tpc`) for reviewers in the corresponding role.
   - Enforced stage-level role authorization for all non-admin reviewers.
3. **Frontend Header Fallback Hardening (`auth.ts`)**:
   - Restricted accepted header fallback roles strictly to a valid role whitelist (`Admin`, `MIS Team`, `Clearance Team`, `TPC Pricing Team`, `Tender Executive`, etc.).
   - Added `REQUIRE_JWT_AUTH=true` environment toggle for production deployments to disable header fallback entirely.
4. **Next.js Route Hardening**:
   - `api/tenders/[id]/route.ts`: Switched `PATCH` and `DELETE` to use `getAuthFromRequest(request)`. Restricted `DELETE` strictly to `Admin` and `MIS Team`.
   - `api/tenders/[id]/generate-bid-docs/route.ts`: Integrated `getAuthFromRequest(request)` and enforced an allowed role check (`Tender Executive`, `MIS Team`, `Admin`).

### 3. Verification
- `mvn clean compile -f backend/pom.xml`: **`BUILD SUCCESS`** (0 errors).
- `npm run build --prefix frontend`: **Compiled successfully** (0 TypeScript errors, 18/18 routes).
- `test-approvals-center-doc-review.js`: **PASSED**.
- `test-complete-workflow-suite.js`: **20/20 PASSED (100% success rate)**.

---

## 🏁 Summary of Current State

| Metric | Status |
| :--- | :--- |
| **Workflow Stages** | Complete 8-Stage Gated GeM Lifecycle |
| **Approvals Center** | Built, Tested, Integrated across all Roles (Bid Docs Approval Fixed) |
| **Confidentiality Layer** | Zero-leakage redaction on `tpc_purchase_price` |
| **Security & RBAC** | Hardened with Cryptographic JWT priority and Role Whitelisting |
| **Test Suite** | All Tests Passing (100% pass rate across 20-point suite) |
| **Next.js Production Build** | Passing (0 errors) |
| **Spring Boot Build** | Passing (`BUILD SUCCESS`) |
| **PR Readiness** | Fully PR-Ready |

