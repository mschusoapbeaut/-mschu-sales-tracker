# Ms. Chu Sales Tracker — Implementation Report & Handover Guide

**Prepared for:** Ms. Chu Soap & Beaut Team
**Date:** February 14, 2026
**Version:** 2.0 (Updated)
**Prepared by:** Manus AI

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture & Technology Stack](#2-architecture--technology-stack)
3. [Production URLs & Access](#3-production-urls--access)
4. [User Accounts & PIN Codes](#4-user-accounts--pin-codes)
5. [Database Schema](#5-database-schema)
6. [Data Sources & Column Mappings](#6-data-sources--column-mappings)
7. [Email Auto-Sync (IMAP)](#7-email-auto-sync-imap)
8. [Environment Variables](#8-environment-variables)
9. [Access Control & Permissions](#9-access-control--permissions)
10. [Common Maintenance Tasks](#10-common-maintenance-tasks)
11. [API Endpoints Reference](#11-api-endpoints-reference)
12. [File Structure](#12-file-structure)
13. [Deployment & Redeployment](#13-deployment--redeployment)
14. [Troubleshooting Guide](#14-troubleshooting-guide)
15. [Data Backup & Recovery](#15-data-backup--recovery)
16. [Known Issues & Resolutions Log](#16-known-issues--resolutions-log)
17. [Scale-Up & Future Changes Guide](#17-scale-up--future-changes-guide)
18. [Change Request Procedures](#18-change-request-procedures)

---

## 1. System Overview

The Ms. Chu Sales Tracker is a web-based application that tracks and displays sales performance data for the Ms. Chu Soap & Beaut team. It serves two primary user groups: **Admin** (Cindy Chu) and **Sales Staff** (11 team members). The system handles both **Online Sales** (from Shopify) and **POS Sales** (from in-store point-of-sale transactions), providing each staff member with visibility into their own sales performance while giving the admin a complete overview of all sales data.

The application is deployed on **Railway** and uses a **MySQL database** (also hosted on Railway) for persistent storage. Sales data enters the system through two channels: **automatic email synchronisation** (IMAP) that fetches Shopify report emails every hour, and **manual CSV/Excel file uploads** through the admin interface.

### Key Features

The application provides the following core capabilities:

| Feature | Description |
|---------|-------------|
| POS Sales Tracking | Displays in-store sales with Order Date, Order Name, Location Name, Payment Gateway, Staff Name, and Net Sales (excluding GC Payment) |
| Online Sales Tracking | Displays Shopify online orders with Order Date, Order Name, Sales Channel, Customer Tags, Email/SMS Marketing, Shipping Price, Total Sales, Net Sales, and Net Sales** |
| Staff Performance View | Each staff member sees only their own month-to-date sales data |
| Admin Dashboard | Full year-to-date view with month/staff/today filters for all data |
| Automatic Email Sync | Hourly IMAP sync fetches all POS and Online report emails from today's mailbox |
| Manual Upload | Admin can upload Excel/CSV files for both POS and Online sales |
| Staff-View Page | Simplified view optimised for POS devices at `/staff-view` |

---

## 2. Architecture & Technology Stack

The system is built as a single Express.js server that serves both the API endpoints and the HTML-based admin/staff interfaces.

| Component | Technology | Details |
|-----------|-----------|---------|
| Backend Server | Node.js + Express.js + TypeScript | Single server file: `server/standalone-server-combined.ts` |
| Database | MySQL (Railway) | Managed MySQL instance on Railway |
| DB Access | Raw SQL via `mysql2/promise` | Connection through `server/db.ts` |
| Email Sync | IMAP (via `imap` + `mailparser` packages) | Connects to Outlook; processes ALL emails from today, every 1 hour |
| Excel Parsing | `xlsx` package | Parses `.xlsx` attachments from email reports |
| Deployment | Railway | Auto-deploys from GitHub; config in `railway.json` |
| Mobile App | Expo SDK 54 + React Native | Staff-facing mobile app (separate from web admin) |
| Authentication | PIN-based login | Each staff member has a unique 4-digit PIN |
| Source Control | GitHub (private repo) | `mschusoapbeaut/-mschu-sales-tracker` |

The production server entry point is `server/standalone-server-combined.ts`, which is started via the command `npx tsx server/standalone-server-combined.ts` as configured in `railway.json`. The server handles all routing, authentication, API endpoints, and HTML rendering in a single file.

---

## 3. Production URLs & Access

| Resource | URL / Location |
|----------|---------------|
| Production Web App | `https://mschu-sales-tracker-production.up.railway.app/` |
| Staff View (POS devices) | `https://mschu-sales-tracker-production.up.railway.app/staff-view` |
| Health Check | `https://mschu-sales-tracker-production.up.railway.app/api/health` |
| Railway Dashboard | [railway.app](https://railway.app) — manage deployment, logs, database |
| GitHub Repository | `github.com/mschusoapbeaut/-mschu-sales-tracker` (private) |
| Source Code (Manus) | Exportable from the Code panel in Manus platform |

---

## 4. User Accounts & PIN Codes

All user accounts are seeded automatically when the server starts. The `seedStaffData()` function in the standalone server ensures all staff members exist in the database.

| Name | Role | PIN | Staff ID |
|------|------|-----|----------|
| Cindy Chu | Admin | 9999 | — |
| Egenie Tang | Staff | 4640 | 78319321135 |
| Eva Lee | Staff | 8577 | 78319255599 |
| Maggie Liang | Staff | 4491 | 78319190063 |
| Maggie Wong | Staff | 9635 | 79208775727 |
| Ting Siew | Staff | 3639 | 78319386671 |
| Win Lee | Staff | 1384 | 78319550511 |
| Wing Ho | Staff | 4019 | 78319091759 |
| Sharon Li | Staff | 6762 | 101232115995 |
| Hailey Hoi Ling Wong | Staff | 9849 | 109111279899 |
| Bon Lau | Staff | 2115 | 111913632027 |
| Sze | Staff | 2791 | 118809198875 |

**Inactive Staff IDs** (no longer mapped): 106673766683, 78319419439, 97046495515, 109135560987.

### How to Add a New Staff Member

1. Open `server/standalone-server-combined.ts`.
2. Find the `seedStaffData()` function (near the top of the file).
3. Add a new entry to the `staffMembers` array:
   ```typescript
   { name: "New Staff Name", pin: "XXXX", staffId: "SHOPIFY_STAFF_ID", role: "staff" },
   ```
4. Choose a unique 4-digit PIN not already in use.
5. The `staffId` must exactly match the Shopify staff ID in POS reports (e.g., "78319190063").
6. Push the code to GitHub — Railway will auto-deploy.

### How to Change a PIN or Remove Staff

To change a PIN, update the `pin` value in the `staffMembers` array and redeploy. To deactivate a staff member, remove their entry from the array and redeploy. Historical sales data is preserved in the database.

---

## 5. Database Schema

The application uses a MySQL database with two key tables.

### 5.1 Users Table (`users`)

| Column | Type | Description |
|--------|------|-------------|
| id | INT (PK) | Auto-incrementing primary key |
| openId | VARCHAR(64) | Unique identifier for auth |
| name | TEXT | Staff member's display name |
| email | VARCHAR(320) | Email address (optional) |
| role | ENUM('user','admin') | Access level |
| staffId | VARCHAR(50) | Shopify staff ID for report mapping |
| pin | VARCHAR(10) | 4-digit login PIN |
| monthlyTarget | DECIMAL(12,2) | Monthly sales target |
| createdAt | TIMESTAMP | Account creation date |

### 5.2 Sales Table (`sales`)

This is the main data table storing both Online and POS sales records.

| Column | Type | Description |
|--------|------|-------------|
| id | INT (PK) | Auto-incrementing primary key |
| orderDate | DATE | Date of the order |
| orderNo | VARCHAR | Order name/number (e.g., "75254") |
| salesChannel | VARCHAR | Location name (POS) or sales channel (Online) |
| netSales | DECIMAL | Net sales amount in HKD |
| saleType | ENUM('online','pos') | Distinguishes online vs POS sales |
| staffId | VARCHAR | Staff ID reference |
| staffName | VARCHAR | Staff name + ID (e.g., "Maggie Liang 78319190063") |
| paymentGateway | VARCHAR | Payment method (POS only) |
| emailMarketing | VARCHAR | Email marketing attribution (Online only) |
| smsMarketing | VARCHAR | SMS marketing attribution (Online only) |
| customerEmail | VARCHAR | Customer email (Online only) |
| actualOrderDate | DATE | Original order date if different |
| whatsappMarketing | VARCHAR | WhatsApp marketing attribution |
| shippingPrice | DECIMAL | Shipping cost |
| totalSales | DECIMAL | Total sales amount |
| createdAt | TIMESTAMP | Record creation timestamp |

> **Important:** The `orderNo` column is used as the unique key for duplicate detection. The system uses upsert logic (INSERT ... ON DUPLICATE KEY UPDATE) to prevent duplicates when the same order appears in multiple email reports.

---

## 6. Data Sources & Column Mappings

### 6.1 POS Sales Data (from `POS_Sales_Attribution` report)

POS sales data comes from Excel files named `POS_Sales_Attribution`. These are **week-to-date cumulative reports** — each report contains all orders from the start of the week up to the time the report was generated. Reports are sent to the mailbox hourly.

| Display Field | Excel Column Header | Column Letter |
|--------------|---------------------|---------------|
| Order Name | Order Name | A |
| Payment Gateway | Payment Gateways | B |
| Staff Name | Staff_Name | C |
| Location Name | Location Name | E |
| Order Date | Order Date | F |
| Net Sales (displayed as "Net sales exclude GC Payment") | Net sales exclude GC Payment | N |

> **Critical:** The system uses **"Net sales exclude GC Payment" (Column N)** as the displayed net sales value, NOT the regular "Net Sales" column. This excludes gift card payments from the totals. If the report format changes, both `server/standalone-server-combined.ts` (upload endpoint) and `server/email-sync.ts` (auto-sync) must be updated.

### 6.2 Online Sales Data (from `Online Orders by customer` email)

Online sales data is fetched from emails with the subject **"Online Orders by customer"**.

**Admin View Columns:**

| Display Field | Excel Column Header | Column Letter |
|--------------|---------------------|---------------|
| Order Date | Order Date | A |
| Order Name | Order Name | B |
| Sales Channel | Sales Channel | C |
| Customer Tags (StaffReferred) | Customer Tags | E |
| Email Marketing | Email Marketing | G |
| SMS Marketing | SMS Marketing | H |
| Shipping Price | Shipping Price | R |
| Total Sales | Total Sales | P |
| Net Sales | Net Sales | O |
| Net Sales** | *Calculated* | Total Sales − Shipping Price |

**Staff View Columns:** Order Date, Order Name, Channel, Email Marketing, SMS Marketing, Net Sales** (staff cannot see Customer Tags, Shipping Price, or Total Sales).

### 6.3 Shipping Price Display Logic

The Shipping Price column follows specific display rules:

| Condition | Display Value |
|-----------|--------------|
| Shipping Price > 0 | Actual value (e.g., HK$50.00) |
| Shipping Price = 0 AND Total Sales > 0 | HK$30.00 (default flat rate) |
| Shipping Price = 0 AND Total Sales = 0 | "-" (dash) |
| No shipping data | "-" (dash) |
| Shipping Price > $100 | Displayed in **red** font colour |

---

## 7. Email Auto-Sync (IMAP)

The email sync module (`server/email-sync.ts`) connects to the configured email account via IMAP and automatically fetches sales report emails.

### How It Works

1. **Schedule:** Runs every **1 hour** automatically (configurable via the `ONE_HOUR` constant in `email-sync.ts`).
2. **Search Strategy:** For each report type, the sync searches for **ALL emails from today** matching the subject filter. If no emails are found from today, it falls back to the single latest email overall.
3. **Report Types:**
   - Subject containing **"Online Orders by customer"** → processed as Online Sales
   - Subject containing **"POS_Sales_Attribution"** → processed as POS Sales
4. **Processing:** Each email's Excel attachment is parsed using the column mappings above. The system uses **upsert logic** — existing records (matched by `orderNo`) are updated, and new records are inserted.
5. **Logging:** The sync logs detailed information including: number of emails found, UIDs processed, records inserted vs updated, and any errors.

### Why Process ALL Emails from Today

The POS reports are **week-to-date cumulative snapshots** generated hourly. Each report contains all orders from the start of the week up to the generation time. By processing ALL emails from today (not just the latest), the system ensures:
- Every hourly snapshot is captured, even if the latest email has a parsing issue
- No orders are missed due to timing gaps between report generation and sync execution
- The upsert logic safely handles overlapping data across multiple reports

### Manual Sync

Admin users can trigger a manual sync from the admin interface by clicking **"Fetch Now"** in the Email Sync section, or via the API endpoint `POST /api/email/fetch`.

---

## 8. Environment Variables

The following environment variables must be configured on Railway.

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | MySQL connection string (provided by Railway MySQL add-on) |
| `PORT` | No | Server port (defaults to 8080; Railway sets this automatically) |
| `EMAIL_ADDRESS` | For email sync | Outlook email address for IMAP sync |
| `EMAIL_PASSWORD` | For email sync | App password for the email account (not regular password if 2FA is enabled) |
| `EMAIL_ENABLED` | For email sync | Set to `"true"` to enable automatic email sync |

To update environment variables: Railway Dashboard → select the service → **Variables** tab → update values. The service restarts automatically after changes.

---

## 9. Access Control & Permissions

The system enforces strict role-based access control. Admin-only panels are completely removed from the DOM for staff users (not just hidden via CSS), preventing any client-side bypass.

| Feature | Admin | Staff |
|---------|-------|-------|
| View all staff sales data | Yes | No |
| View own sales data | Yes | Yes (month-to-date only) |
| Filter by staff member | Yes | No |
| Filter by month / Today / YTD | Yes | No |
| Upload sales data | Yes | No |
| Clear monthly data | Yes | No |
| Manage staff accounts | Yes | No |
| Email sync configuration | Yes | No |
| View POS Sales tab | Yes | Yes |
| View Online Sales tab | Yes | Yes |

Staff members see only their own sales records for the **current month** (month-to-date). Admin can view the entire year's data and filter by any staff member, month, "Today", or "Year to Date".

---

## 10. Common Maintenance Tasks

### 10.1 Uploading POS Sales Data (Manual)

1. Log in at the production URL using admin PIN **9999**.
2. Click the **"Upload Sales"** tab.
3. Select **"POS Sales"** from the sale type dropdown.
4. Paste CSV data or upload a file. If you have an Excel file, open it first and copy-paste the data, or save as CSV.
5. Click **"Upload Sales Data"**. The system automatically skips duplicate records (matched by Order Name).

### 10.2 Replacing Data for a Specific Month

1. Scroll to the **"Clear Monthly Data"** section on the Upload Sales tab.
2. Select the month and sale type (POS Sales or Online Sales).
3. Click **"Clear Data"** — this deletes all records for that month and type.
4. Upload the corrected file using the steps above.

### 10.3 Uploading Online Sales Data (Manual)

Same process as POS, but select **"Online Sales"** from the dropdown. The system automatically filters out Point of Sale orders from Online Sales uploads.

### 10.4 Checking Email Sync Status

1. Log in as admin.
2. Go to the **Email Sync** section.
3. View the last sync time and result (number of emails processed, records imported).
4. Click **"Fetch Now"** to trigger an immediate sync.
5. Click **"Test Connection"** to verify IMAP connectivity.

### 10.5 Adding a New Staff Member

See [Section 4](#4-user-accounts--pin-codes) for detailed instructions.

### 10.6 Changing the Email Sync Frequency

1. Open `server/email-sync.ts`.
2. Find the `ONE_HOUR` constant (currently `3600000` milliseconds = 1 hour).
3. Change to desired interval (e.g., `1800000` for 30 minutes).
4. Push to GitHub and redeploy.

---

## 11. API Endpoints Reference

All API endpoints are served from the standalone server. Authentication is required for most endpoints (via session cookie from PIN login).

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/health` | Health check | No |
| POST | `/api/auth/pin` | PIN login — body: `{ "pin": "XXXX" }` | No |
| GET | `/api/sales` | Get sales data — query: `type`, `month`, `staffName` | Yes |
| GET | `/api/sales/staff-names` | Get unique staff names for filter dropdown | Yes |
| POST | `/api/sales/upload` | Upload CSV data — body: `{ "csvData": "...", "saleType": "pos" }` | Admin |
| POST | `/api/sales/clear` | Clear monthly data — body: `{ "month": "2026-01", "saleType": "pos" }` | Admin |
| POST | `/api/sales/update-staff` | Update staff assignments for sales records | Admin |
| DELETE | `/api/sales/:id` | Delete a single sales record | Admin |
| GET | `/api/staff` | Get all staff members | Admin |
| POST | `/api/staff` | Add a new staff member | Admin |
| DELETE | `/api/staff/:id` | Delete a staff member | Admin |
| GET | `/api/email/config` | Get email sync configuration | Admin |
| POST | `/api/email/test` | Test IMAP connection | Admin |
| POST | `/api/email/fetch` | Trigger manual email sync | Admin |

### Month Filter Values

The `month` query parameter on `/api/sales` accepts the following values:

| Value | Behaviour |
|-------|-----------|
| `all` | Returns all records (no date filter) |
| `today` | Returns records from today (Hong Kong timezone, UTC+8) |
| `ytd` | Returns records from January 1 of current year to today |
| `2026-02` | Returns records from the specified month |

---

## 12. File Structure

| File | Purpose |
|------|---------|
| `server/standalone-server-combined.ts` | **Main production server** — all API endpoints, HTML templates, staff seeding, auto-migration |
| `server/email-sync.ts` | Email IMAP sync module — automatic fetching and parsing of sales report emails |
| `server/db.ts` | Database connection and query functions |
| `server/standalone-auth.ts` | PIN-based authentication logic |
| `drizzle/schema.ts` | Database schema definitions (Drizzle ORM, used by mobile app) |
| `railway.json` | Railway deployment configuration |
| `app.config.ts` | Expo mobile app configuration (branding, bundle ID) |
| `lib/report-parser.ts` | Excel/CSV report parsing utilities |
| `app/(tabs)/index.tsx` | Mobile app home screen |
| `app/(tabs)/pos-sales.tsx` | Mobile app POS sales tab |
| `app/(tabs)/online-sales.tsx` | Mobile app Online sales tab |
| `todo.md` | Complete history of all features, bugs, and fixes |

---

## 13. Deployment & Redeployment

The application is deployed on Railway with auto-deploy from GitHub.

### Standard Deployment Flow

1. Make code changes in the Manus platform (or locally).
2. Save a checkpoint in Manus (creates a Git commit and pushes to GitHub).
3. Railway automatically detects the new commit and starts building.
4. Build takes approximately 2-3 minutes.
5. Railway runs the health check at `/api/health` before routing traffic to the new version.

### Manual Redeployment

If auto-deploy doesn't trigger, go to the Railway dashboard, select the service, and click **"Redeploy"** on the latest deployment.

### Railway Configuration (`railway.json`)

```json
{
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "pnpm install"
  },
  "deploy": {
    "startCommand": "npx tsx server/standalone-server-combined.ts",
    "healthcheckPath": "/api/health",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### Verifying Deployment

After pushing code, verify the deployment is live by:

1. Checking the Railway dashboard for deployment status (should show "Success").
2. Visiting the health check endpoint: `GET /api/health`.
3. Logging into the admin interface and confirming the changes are visible.

---

## 14. Troubleshooting Guide

### 14.1 Sales Data Not Appearing

| Check | Action |
|-------|--------|
| Wrong tab? | POS and Online sales are separate tabs. Verify you're on the correct one. |
| Month filter? | If a specific month is selected, records outside that range won't show. Try "All". |
| NULL dates? | Records with missing Order Date won't match any month filter. Use "All" to find them. |
| Railway logs? | Check Railway dashboard → deployment logs for error messages. |

### 14.2 Email Sync Not Importing New Data

| Check | Action |
|-------|--------|
| Credentials set? | Verify `EMAIL_ADDRESS`, `EMAIL_PASSWORD`, `EMAIL_ENABLED=true` in Railway Variables. |
| Connection works? | Use "Test Connection" button in admin Email Sync section. |
| App Password? | For Outlook with 2FA, you must use an App Password, not your regular password. |
| Correct subjects? | Emails must have subject containing "Online Orders by customer" or "POS_Sales_Attribution". |
| Report timing? | POS reports are cumulative snapshots. If the latest report was generated before recent orders, those orders won't appear until the next report is sent. |
| All emails processed? | The sync now processes ALL emails from today. Check logs for "Found X emails from today". |

### 14.3 Data Shows Incorrect Totals

| Issue | Cause | Fix |
|-------|-------|-----|
| POS total doesn't match report | Old records with NULL dates may be included | Clear and re-upload the month's data |
| Today filter shows $0 | Timezone issue — server may be in UTC | The "Today" filter uses HK timezone (UTC+8); verify dates in DB |
| Staff total doesn't match | Staff name format mismatch | Check that staffName in DB matches exactly (includes Staff ID) |

### 14.4 Duplicate Records

The system has built-in duplicate detection by Order Name. If duplicates appear:
1. Use **"Clear Monthly Data"** to remove all records for the affected month and sale type.
2. Re-upload the correct data file.

### 14.5 Server Not Starting

1. Check Railway deployment logs for error messages.
2. Verify `DATABASE_URL` is correctly set and the MySQL database is accessible.
3. Try redeploying from the Railway dashboard.

---

## 15. Data Backup & Recovery

Railway's MySQL database includes automatic backups. For manual backup:

1. Get the `DATABASE_URL` from Railway's Variables tab.
2. Use `mysqldump` or a MySQL client to export the `sales` and `users` tables.
3. Store the backup securely.

To restore data, use `mysql` command-line tool to import the SQL dump. To clear and re-import a specific month, use the **"Clear Monthly Data"** feature in the admin interface.

---

## 16. Known Issues & Resolutions Log

This section documents significant issues encountered during development and their resolutions, serving as a reference for future troubleshooting.

| Date | Issue | Root Cause | Resolution |
|------|-------|-----------|------------|
| Feb 13, 2026 | POS records with NULL orderDate not matching month filters | Old import parser didn't map Order Date column | Cleared 405 NULL-date records; re-imported Jan POS data with fixed parser |
| Feb 13, 2026 | Email sync only fetched 1 email per report type, missing orders | `Math.max(...results)` only kept the latest UID | Changed to process ALL emails from today using IMAP SINCE filter |
| Feb 13, 2026 | "Today" filter showed 0 records | Server in UTC, dates stored in HK timezone | Fixed to use HK timezone (UTC+8) for "today" date calculation |
| Feb 13, 2026 | Latest POS orders not at top of table | SQL sorted by `orderDate DESC` only; same-date records in random order | Added secondary sort: `ORDER BY orderDate DESC, CAST(orderNo AS UNSIGNED) DESC` |
| Feb 13, 2026 | Railway not auto-deploying after git push | Build takes 2-3 minutes; appeared stuck | Confirmed auto-deploy works; just needs patience for build to complete |
| Feb 13, 2026 | Shipping Price showing "-" for $0 orders | totalSales column not populated for old records | Added totalSales import; default $30 only when shipping=$0 AND totalSales>0 |
| Feb 6, 2026 | Staff could see admin panels (Staff Management, PINs) | Admin tabs hidden via CSS but still in DOM | Removed admin panels from DOM entirely for staff users |
| Feb 6, 2026 | Cookie not setting on Railway domain | Public suffix domain handling | Fixed cookie domain configuration for Railway deployment |

---

## 17. Scale-Up & Future Changes Guide

This section provides guidance for common changes that may be needed as the business grows.

### 17.1 Adding New Report Columns

If Shopify adds new columns to the POS or Online reports:

1. **Add the column to the database:** Add an `ALTER TABLE` statement in the auto-migration section of `server/standalone-server-combined.ts` (search for `ALTER TABLE sales ADD COLUMN`).
2. **Update the email sync parser:** In `server/email-sync.ts`, find the column mapping section for the relevant report type and add the new column mapping.
3. **Update the upload parser:** In `server/standalone-server-combined.ts`, find the upload endpoint and add the new column to the CSV parsing logic.
4. **Update the display:** In the HTML template section of `server/standalone-server-combined.ts`, add the new column to the table headers and row rendering.
5. **Redeploy.**

### 17.2 Changing Report Column Mappings

If Shopify changes the column order in their reports:

1. Open `server/email-sync.ts` and find the column mapping section (search for "Map columns by header name").
2. The system uses **header-based detection** (not positional), so if column headers stay the same but positions change, no code change is needed.
3. If headers change, update the header name strings in the mapping logic.
4. Apply the same changes to the upload endpoint in `server/standalone-server-combined.ts`.

### 17.3 Adding New Locations or Sales Channels

No code changes needed. Location names and sales channels are stored as-is from the reports. New locations will automatically appear in the data.

### 17.4 Increasing Sync Frequency

To sync more frequently than every hour:

1. Open `server/email-sync.ts`.
2. Find `const ONE_HOUR = 3600000;`
3. Change to desired interval in milliseconds (e.g., `1800000` for 30 minutes, `900000` for 15 minutes).
4. Redeploy.

> **Note:** More frequent syncing means more IMAP connections to the email server. Outlook may rate-limit connections if the interval is too short (recommended minimum: 15 minutes).

### 17.5 Adding New Tabs or Views

To add a new data view (e.g., "Returns" tab):

1. In `server/standalone-server-combined.ts`, add a new tab button in the admin HTML template.
2. Add the corresponding panel/table HTML.
3. Add JavaScript functions for loading and rendering the data.
4. Add any new API endpoints needed.
5. Update the staff view if staff should also see the new tab.

### 17.6 Migrating to a Different Email Provider

The IMAP configuration in `server/email-sync.ts` auto-detects the provider based on the email domain:

- `@outlook.com`, `@hotmail.com`, `@live.com` → `outlook.office365.com`
- `@gmail.com` → `imap.gmail.com`

To add a new provider, add a new condition in the `getImapConfig()` function with the correct IMAP host and port.

### 17.7 Scaling the Database

The current MySQL instance on Railway handles the current data volume well (approximately 2,300+ POS records and growing). For larger datasets:

- Add database indexes on frequently queried columns (`orderDate`, `saleType`, `staffName`).
- Consider partitioning the `sales` table by month if it exceeds 100,000 records.
- Railway allows upgrading the MySQL instance size from the dashboard.

### 17.8 Adding Multi-Store Support

If Ms. Chu expands to multiple stores with separate tracking needs:

1. Add a `storeId` column to the `sales` table.
2. Update the upload and email sync to tag records with the appropriate store.
3. Add a store filter to the admin interface.
4. Update staff permissions to restrict visibility by store.

---

## 18. Change Request Procedures

When a change needs to be made to the application, follow this procedure to ensure smooth implementation:

### Step 1: Document the Change

Before making any changes, document:
- What needs to change and why
- Which files are affected (refer to [Section 12](#12-file-structure))
- Whether the change affects the database schema, email sync, or display only

### Step 2: Make the Change

1. Open the relevant files in the Manus platform or a local editor.
2. Make the code changes.
3. Test locally if possible (run `npx tsx server/standalone-server-combined.ts`).

### Step 3: Deploy

1. Save a checkpoint in Manus (or push to GitHub directly).
2. Wait 2-3 minutes for Railway to build and deploy.
3. Verify the deployment status on the Railway dashboard.
4. Log into the production app and confirm the changes are working.

### Step 4: Verify

1. Check the specific feature or fix that was changed.
2. Verify that existing features still work (POS tab, Online tab, staff login, filters).
3. If the change involved email sync, trigger a manual fetch and verify the results.

### Step 5: Update This Document

Add the change to the [Known Issues & Resolutions Log](#16-known-issues--resolutions-log) if it was a bug fix, or update the relevant section if it was a feature addition.

---

*This document was prepared to facilitate maintenance, handover, and future development of the Ms. Chu Sales Tracker application. For questions or support, please contact the development team through the Manus platform.*

*Last updated: February 14, 2026 — Version 2.0*
