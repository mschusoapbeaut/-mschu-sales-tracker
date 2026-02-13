# Ms. Chu Sales Tracker — Handover & Maintenance Guide

**Prepared for:** Ms. Chu Soap & Beaut Team
**Date:** February 13, 2026
**Version:** 1.0

---

## 1. System Overview

The Ms. Chu Sales Tracker is a web-based application that tracks and displays sales performance data for the Ms. Chu Soap & Beaut team. It serves two primary user groups: **Admin** (Cindy Chu) and **Sales Staff** (11 team members). The system handles both **Online Sales** (from Shopify) and **POS Sales** (from in-store point-of-sale transactions), providing each staff member with visibility into their own sales performance while giving the admin a complete overview of all sales data.

The application is deployed on **Railway** and uses a **MySQL database** (also hosted on Railway) for persistent storage. Sales data enters the system through two channels: automatic email synchronisation (IMAP) that fetches Shopify report emails every hour, and manual CSV/Excel file uploads through the admin interface.

---

## 2. Architecture & Technology Stack

The system is built as a single Express.js server that serves both the API endpoints and the HTML-based admin/staff interfaces. The table below summarises the key technology components.

| Component | Technology | Details |
|-----------|-----------|---------|
| Backend Server | Node.js + Express.js + TypeScript | Single server file: `server/standalone-server-combined.ts` |
| Database | MySQL (Railway) | Managed MySQL instance on Railway |
| ORM / DB Access | Raw SQL via `mysql2/promise` | Connection through `server/db.ts` |
| Email Sync | IMAP (via `imap` + `mailparser` packages) | Connects to Outlook; runs every 1 hour |
| Deployment | Railway | Auto-deploys from Git; config in `railway.json` |
| Mobile App | Expo SDK 54 + React Native | Staff-facing mobile app (separate from web admin) |
| Authentication | PIN-based login | Each staff member has a unique 4-digit PIN |

The production server entry point is `server/standalone-server-combined.ts`, which is started via the command `npx tsx server/standalone-server-combined.ts` as configured in `railway.json`.

---

## 3. Production URLs & Access

| Resource | URL / Location |
|----------|---------------|
| Production Web App | `https://mschu-sales-tracker-production.up.railway.app/` |
| Staff View | `https://mschu-sales-tracker-production.up.railway.app/staff-view` |
| Health Check | `https://mschu-sales-tracker-production.up.railway.app/api/health` |
| Railway Dashboard | Log in to [railway.app](https://railway.app) to manage deployment |
| Source Code | Managed via Manus platform; can be exported from the Code panel |

---

## 4. User Accounts & PIN Codes

All user accounts are seeded automatically when the server starts. The `seedStaffData()` function in the standalone server ensures all staff members exist in the database. Below is the complete list of staff accounts.

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

To add a new staff member, add their details to the `staffMembers` array in the `seedStaffData()` function within `server/standalone-server-combined.ts`, then redeploy. The server will automatically create the new user on next startup.

To change a staff member's PIN, update the `pin` value in the same `staffMembers` array and redeploy.

---

## 5. Database Schema

The application uses a MySQL database with the following key tables.

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

This is the main data table. It stores both Online and POS sales records. The table uses raw SQL columns (not the Drizzle ORM schema) in production.

| Column | Type | Description |
|--------|------|-------------|
| id | INT (PK) | Auto-incrementing primary key |
| orderDate | DATE | Date of the order |
| orderNo | VARCHAR | Order name/number (e.g., "5-13969") |
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

---

## 6. Data Sources & Column Mappings

### 6.1 POS Sales Data (from `POS_Sales_Attribution` report)

POS sales data comes from Excel files named `POS_Sales_Attribution`. The column mapping is as follows:

| Display Field | Excel Column | Column Letter |
|--------------|-------------|---------------|
| Order Name | Order Name | A |
| Payment Gateway | Payment Gateways | B |
| Staff Name | Staff_Name | C |
| Location Name | Location Name | E |
| Order Date | Order Date | F |
| Net Sales (displayed) | Net sales exclude GC Payment | N |

The system uses **"Net sales exclude GC Payment" (Column N)** as the displayed net sales value, not the regular "Net Sales" column. This is important because it excludes gift card payments from the totals.

### 6.2 Online Sales Data (from `Online Orders by customer` email)

Online sales data is fetched automatically from emails with the subject line **"Online Orders by customer"**. The column mapping for the admin interface is:

| Display Field | Excel Column | Column Letter |
|--------------|-------------|---------------|
| Order Date | Order Date | A |
| Order Name | Order Name | B |
| Sales Channel | Sales Channel | C |
| Customer Tags | Customer Tags (StaffReferred) | E |
| Email Marketing | Email Marketing | G |
| SMS Marketing | SMS Marketing | H |
| Net Sales | Net Sales | O |

Staff members can only see: Order Date, Order Name, Channel, Email Marketing, SMS Marketing, and Net Sales. They cannot see Customer Tags or other staff members' data.

---

## 7. Environment Variables

The following environment variables must be configured on Railway for the production server to function correctly.

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | MySQL connection string (provided by Railway MySQL add-on) |
| `PORT` | No | Server port (defaults to 8080; Railway sets this automatically) |
| `EMAIL_ADDRESS` | For email sync | Outlook email address for IMAP sync |
| `EMAIL_PASSWORD` | For email sync | App password for the email account |
| `EMAIL_ENABLED` | For email sync | Set to `"true"` to enable automatic email sync |

To update environment variables, go to the Railway dashboard, select the service, navigate to the **Variables** tab, and update the values. The service will automatically restart after changes.

---

## 8. Common Maintenance Tasks

### 8.1 Uploading POS Sales Data (Manual)

When you receive a new POS Sales Attribution report, follow these steps:

1. Log in to the admin interface at the production URL using PIN **9999**.
2. Click the **"Upload Sales"** tab (visible only to admin).
3. Select **"POS Sales"** from the sale type dropdown.
4. Paste the CSV data or use the file upload area. The system expects CSV format — if you have an Excel file, open it in Excel first and copy-paste the data, or save as CSV.
5. Click **"Upload Sales Data"**.
6. The system will automatically skip duplicate records (matching by Order Name).

If you need to replace all data for a specific month (e.g., re-uploading a corrected report):

1. Scroll down to the **"Clear Monthly Data"** section on the Upload Sales tab.
2. Select the month and sale type (POS Sales).
3. Click **"Clear Data"** — this will delete all records for that month and type.
4. Then upload the corrected file using the steps above.

### 8.2 Uploading Online Sales Data (Manual)

The same process applies, but select **"Online Sales"** from the sale type dropdown. Note that the system automatically filters out Point of Sale orders from Online Sales uploads to prevent cross-contamination.

### 8.3 Email Auto-Sync

The system automatically fetches sales report emails every **1 hour** when email sync is enabled. It searches for two types of emails:

- Emails with subject containing **"Online Orders by customer"** — processed as Online Sales
- Emails with subject containing **"POS_Sales_Attribution"** — processed as POS Sales

The sync skips any orders that already exist in the database (duplicate detection by Order Name). To check the sync status, use the **Email Sync** section in the admin interface, which shows the last sync time and result.

### 8.4 Adding a New Staff Member

To add a new staff member to the system:

1. Open `server/standalone-server-combined.ts`.
2. Find the `seedStaffData()` function (near the top of the file, around line 22).
3. Add a new entry to the `staffMembers` array:
   ```typescript
   { name: "New Staff Name", pin: "XXXX", staffId: "SHOPIFY_STAFF_ID", role: "staff" },
   ```
4. Choose a unique 4-digit PIN that is not already in use.
5. The `staffId` should match the Shopify staff ID used in the POS reports (the number after the staff name, e.g., "78319190063").
6. Redeploy the application on Railway.

### 8.5 Removing a Staff Member

To deactivate a staff member, simply remove their entry from the `staffMembers` array in `seedStaffData()` and redeploy. Their historical sales data will remain in the database but they will no longer be able to log in.

### 8.6 Changing a Staff Member's PIN

Update the `pin` value in the `staffMembers` array within `seedStaffData()` and redeploy. The server will update the PIN on next startup.

---

## 9. Access Control & Permissions

The system enforces strict role-based access control:

| Feature | Admin | Staff |
|---------|-------|-------|
| View all staff sales data | Yes | No |
| View own sales data | Yes | Yes (month-to-date only) |
| Filter by staff member | Yes | No |
| Filter by month (full year) | Yes | No |
| Upload sales data | Yes | No |
| Clear monthly data | Yes | No |
| Manage staff accounts | Yes | No |
| Email sync configuration | Yes | No |
| View POS Sales tab | Yes | Yes |
| View Online Sales tab | Yes | Yes |

Staff members can only see their own sales records for the **current month** (month-to-date). Admin can view the entire current year's data and filter by any staff member or month.

---

## 10. API Endpoints Reference

All API endpoints are served from the standalone server. Authentication is required for most endpoints (via session cookie from PIN login).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check (no auth required) |
| POST | `/api/auth/pin` | PIN login — body: `{ "pin": "XXXX" }` |
| GET | `/api/sales` | Get sales data — query params: `type`, `month`, `staffName` |
| GET | `/api/sales/staff-names` | Get list of unique staff names for filter dropdown |
| POST | `/api/sales/upload` | Upload CSV sales data — body: `{ "csvData": "...", "saleType": "pos" }` |
| POST | `/api/sales/clear` | Clear monthly data — body: `{ "month": "2026-01", "saleType": "pos" }` |
| POST | `/api/sales/update-staff` | Update staff assignments for sales records |
| DELETE | `/api/sales/:id` | Delete a single sales record |
| GET | `/api/staff` | Get all staff members |
| POST | `/api/staff` | Add a new staff member |
| DELETE | `/api/staff/:id` | Delete a staff member |
| GET | `/api/email/config` | Get email sync configuration |
| POST | `/api/email/test` | Test IMAP connection |
| POST | `/api/email/fetch` | Trigger manual email sync |

---

## 11. File Structure (Key Files)

The following table lists the most important files in the project that a developer or maintainer would need to understand or modify.

| File | Purpose |
|------|---------|
| `server/standalone-server-combined.ts` | **Main production server** — contains all API endpoints, HTML templates for admin/staff views, staff seeding, and auto-migration logic |
| `server/email-sync.ts` | Email IMAP sync module — handles automatic fetching and parsing of sales report emails |
| `server/db.ts` | Database connection and query functions |
| `server/standalone-auth.ts` | PIN-based authentication logic |
| `drizzle/schema.ts` | Database schema definitions (Drizzle ORM) |
| `railway.json` | Railway deployment configuration |
| `app.config.ts` | Expo mobile app configuration (branding, bundle ID) |
| `lib/report-parser.ts` | Excel/CSV report parsing utilities |
| `app/(tabs)/index.tsx` | Mobile app home screen |
| `app/(tabs)/pos-sales.tsx` | Mobile app POS sales tab |
| `app/(tabs)/online-sales.tsx` | Mobile app Online sales tab |

---

## 12. Deployment & Redeployment

The application is deployed on Railway. To redeploy after making changes:

1. Make your code changes in the Manus platform.
2. Save a checkpoint (this creates a Git commit).
3. Click the **Publish** button in the Manus UI to deploy to Railway.

Railway will automatically:
- Install dependencies (`pnpm install`)
- Start the server (`npx tsx server/standalone-server-combined.ts`)
- Run the health check at `/api/health`
- Restart on failure (up to 10 retries)

The deployment configuration is defined in `railway.json`:
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

---

## 13. Troubleshooting Guide

### 13.1 Sales Data Not Appearing

If sales data is not showing up after an upload or email sync, check the following:

1. **Verify the sale type** — POS and Online sales are stored separately. Make sure you are viewing the correct tab.
2. **Check the month filter** — If a specific month is selected, records outside that date range will not appear. Try selecting "All" to see all records.
3. **Check for NULL dates** — If records were imported with missing Order Date values, they will not match any month filter. Use the "All" time range to find them.
4. **Check the Railway logs** — Go to the Railway dashboard and view the deployment logs for any error messages during upload or sync.

### 13.2 Email Sync Not Working

1. Verify that `EMAIL_ADDRESS`, `EMAIL_PASSWORD`, and `EMAIL_ENABLED=true` are set in Railway environment variables.
2. Use the **"Test Connection"** button in the Email Sync section of the admin interface.
3. For Outlook accounts, ensure you are using an **App Password** (not your regular password) if two-factor authentication is enabled.
4. Check that the email account has emails with the correct subject lines: "Online Orders by customer" or "POS_Sales_Attribution".

### 13.3 Duplicate Records

The system has built-in duplicate detection that checks by Order Name before inserting. If duplicates appear:

1. Use the **"Clear Monthly Data"** feature to remove all records for the affected month and sale type.
2. Re-upload the correct data file.

### 13.4 Server Not Starting

1. Check the Railway deployment logs for error messages.
2. Verify that `DATABASE_URL` is correctly set and the MySQL database is accessible.
3. Try redeploying from the Railway dashboard.

---

## 14. Data Backup & Recovery

Railway's MySQL database includes automatic backups. To manually back up data:

1. Connect to the database using the `DATABASE_URL` from Railway's Variables tab.
2. Use `mysqldump` or a MySQL client to export the `sales` and `users` tables.
3. Store the backup securely.

To restore data from a backup, use `mysql` command-line tool or a MySQL client to import the SQL dump file into the Railway database.

To clear and re-import data for a specific month, use the **"Clear Monthly Data"** feature in the admin interface, then re-upload the correct data file.

---

## 15. Future Considerations

When making changes to the system, keep the following principles in mind:

1. **Column mappings are critical** — The POS report uses Column N ("Net sales exclude GC Payment") as the displayed net sales value, not the regular "Net Sales" column. Any changes to the report format from Shopify will require updating the column detection logic in both `server/standalone-server-combined.ts` (manual upload) and `server/email-sync.ts` (auto-sync).

2. **Staff IDs must match Shopify** — The Staff ID in the system must exactly match the Shopify staff ID that appears in the POS reports (e.g., "78319190063"). If Shopify changes staff IDs, the mapping in `seedStaffData()` must be updated.

3. **Duplicate detection relies on Order Name** — The system uses the Order Name (e.g., "5-13969") as the unique identifier for duplicate detection. If the same order appears in multiple reports with different Order Names, it will be imported as separate records.

4. **The standalone server is self-contained** — The file `server/standalone-server-combined.ts` contains the entire web application (API + HTML). While this makes it easy to deploy, changes to the UI require editing HTML strings within the TypeScript file.

5. **Email sync runs every hour** — The IMAP sync interval is set to 1 hour. If more frequent updates are needed, modify the `ONE_HOUR` constant in `server/email-sync.ts`.

---

*This document was prepared to facilitate maintenance and handover of the Ms. Chu Sales Tracker application. For questions or support, please contact the development team through the Manus platform.*
