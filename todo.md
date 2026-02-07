# Project TODO

## Authentication
- [x] User login screen with Manus OAuth
- [x] Session management and persistence
- [x] Logout functionality
- [x] Role-based access (admin vs regular user)

## Database & Backend
- [x] User table schema with role field
- [x] Sales data table schema
- [x] API endpoints for authentication
- [x] API endpoints for sales data (summary, recent, list, trend, productBreakdown)
- [x] Admin API endpoints (teamSummary, users, importSales)

## Dashboard Features
- [x] KPI cards (Total Sales, Orders, Avg Value, Target Progress)
- [x] Period selector (Week/Month/Year)
- [x] Recent transactions list
- [x] Welcome message with user name
- [x] Pull-to-refresh functionality

## Sales Details
- [x] Product-wise sales breakdown with percentages
- [x] Daily sales trend display
- [x] Transaction history with details
- [x] Tab navigation between breakdown and transactions

## Admin Features
- [x] Report upload functionality (CSV)
- [x] CSV parsing and data extraction
- [x] Import preview with warnings/errors
- [x] View all team members' performance
- [x] Team performance summary

## Profile
- [x] User profile display with avatar
- [x] Admin badge indicator
- [x] Admin panel with upload and team view

## Branding & Polish
- [x] Custom app icon (leaf + growth chart)
- [x] Brand colors implementation (sage green theme)
- [x] App name configuration (Ms. Chu Sales Tracker)
- [x] Splash screen with brand color


## Google Drive Integration
- [x] Set up Google Drive API credentials (requires user to provide)
- [x] Implement OAuth flow for Google Drive connection
- [x] Create file listing from specified Drive folder
- [x] Auto-download and parse CSV/Excel reports
- [x] Add scheduled sync functionality (every 30 minutes)
- [x] Create UI for Drive connection settings
- [x] Display sync status and history


## Excel Report Parsing Update
- [x] Support Excel (.xlsx) file format parsing
- [x] Map WVReferredByStaff (Column E) to staff member
- [x] Extract order_date (Column A), order_name (Column B), sales_channel (Column C)
- [x] Extract net_sales (Column H), total_sales (Column I), refund_adj (Column J)
- [x] Auto-match staff IDs to registered users via Staff ID Mapping UI


## Staff Account Setup
- [x] Create user accounts for 11 team members
- [x] Set staff ID mappings for each user


## Net Sales Update
- [x] Update report parser to use Net Sales instead of Total Sales
- [x] Update existing sales data in database


## UI Update - Sales Display
- [x] Update Sales screen to show: Order Date, Order Name, Sales Channel, Net Sales (HK$)


## User Staff ID Entry
- [x] Add Staff ID input field in Profile screen for all users (not just admins)
- [x] Allow users to link their own account to their sales data via Staff ID


## Shopify POS App Extension
- [x] Add PIN field to user database schema
- [x] Create PIN login screen for quick staff authentication
- [x] Create PIN authentication API endpoint
- [x] Add PIN setup/management in Profile screen
- [x] Create Shopify POS tile linking to app (via App URL configuration)
- [x] Provide deployment and installation instructions


## Staff Email and PIN Setup
- [x] Update staff accounts with email addresses
- [x] Set PINs for all 11 staff members


## Manual Report Upload
- [ ] Add manual Excel/CSV upload option in admin panel
- [ ] Allow admins to upload reports without Google Drive


## Railway Deployment (PIN-only Auth)
- [x] Modify app to use PIN-only authentication
- [x] Remove Manus OAuth dependency
- [x] Create Dockerfile for production build
- [x] Create railway.json configuration
- [x] Export database schema and data
- [x] Create database seed script with all users and sales
- [x] Create deployment guide (RAILWAY_DEPLOYMENT.md)
- [ ] Deploy to Railway (user action required)
- [ ] Configure environment variables (user action required)
- [ ] Test deployed app (user action required)


## Email IMAP Auto-Fetch
- [x] Create email-sync.ts module for IMAP connection
- [x] Support Outlook/Hotmail IMAP (outlook.office365.com)
- [x] Auto-fetch CSV/Excel attachments from unread emails
- [x] Parse and import sales data from attachments
- [x] Schedule auto-fetch every 1 hour
- [x] Add API endpoints: /api/email/status, /api/email/test, /api/email/fetch
- [x] Use environment variables for credentials (EMAIL_ADDRESS, EMAIL_PASSWORD, EMAIL_ENABLED)
- [ ] Add Railway environment variables (user action required)
- [ ] Test email auto-fetch on Railway (user action required)


## Staff Management Update
- [x] Add 11 new staff members with Staff IDs and PINs


## Interface Restoration
- [ ] Restore original admin interface (dist-web based) while keeping email sync
- [ ] Add manual Excel/CSV upload feature to admin panel


## Email Subject Filter
- [ ] Filter emails by subject "New report - Online Orders by customer"


## Tab Rename and POS Sales Addition
- [x] Rename "Sales" tab to "Online Sales"
- [x] Create new "POS Sales" tab with same data fields as Online Sales
- [x] Add Payment Gateway column to POS Sales tab
- [x] Update tab navigation and icons
- [x] Add saleType and paymentGateway fields to database schema
- [x] Add POS sales API endpoints (posList, posSummary)
- [x] Run database migration


## Bug Fixes (Feb 6, 2026)
- [x] Fix PIN login to use 4 digits instead of 6 digits
- [x] Ensure Online Sales and POS Sales tabs are visible on production
- [x] Do not change any existing interface layout


## Email Subject Filter Fix (Feb 6, 2026)
- [ ] Update email subject filter to match "Online Orders by customer tag_Correct"
- [ ] Trigger email sync to fetch sales data
- [ ] Verify data is showing in Online Sales tab


## Email Sync Excel Parsing Fix (Feb 6, 2026)
- [ ] Filter emails by subject "Online Orders by customer"
- [ ] Extract Excel attachment from matching emails
- [ ] Map Excel data according to saved skills field mapping
- [ ] Display imported data in Online Sales tab

- [ ] Remove Column J (Refund Adjustment) from Excel parsing
- [ ] Ensure email data goes to Online Sales tab only (saleType = 'online')


## Staff ID Mapping Setup (Feb 6, 2026)
- [ ] Add staff ID (WVReferredByStaff) to all 11 staff members in database
- [ ] Update PINs for all staff members
- [ ] Verify staff mapping works with email sync


## Admin Login Issue (Feb 6, 2026)
- [ ] Fix admin login - PIN 9999 not working for Cindy Chu


## Email Subject Filter Update (Feb 6, 2026)
- [x] Update email subject filter to match "New report - Online Orders by customer"
- [ ] Test email sync to fetch the correct emails
- [x] Update email sync to only fetch the latest email instead of all matching emails
- [x] Fix email sync to properly import new sales data (use orderNo column)

## Currency Formatting (Feb 6, 2026)
- [ ] Add comma formatting to currency numbers in the interface (e.g., HK$91,660.63)


## Security Fix (Feb 6, 2026)
- [x] CRITICAL: Staff members can see Staff Management tab and all staff data including PINs - must hide from non-admin users
- [x] FIX: Admin panel content still showing to staff on first login (tabs hidden but panel visible)


## POS Sales Email Sync (Feb 6, 2026)
- [ ] Add email sync for POS_Sales_Attribution report
- [ ] Fetch POS report every hour (same schedule as Online Sales)
- [ ] Display POS data in POS Sales tab with columns: Order Date, Order Name, Sales Channel, Net Sales, Payment Gateway
- [ ] Set saleType = 'pos' for POS sales records


## Date Range Filtering (Feb 6, 2026)
- [x] Admin: Show Year-to-Date Sales History (both Online and POS)
- [x] Staff: Show Month-to-Date Sales History only (both Online and POS)


## Month Filter for Admin (Feb 6, 2026)
- [x] Add month dropdown filter for Admin on Online Sales tab
- [x] Add month dropdown filter for Admin on POS Sales tab
- [x] Filter sales data by selected month

## Month Filter Totals Fix (Feb 6, 2026)
- [x] Fix Total Sales to update when month filter is selected
- [x] Fix Total Orders to update when month filter is selected


## Upload Sale Type Selector (Feb 6, 2026)
- [x] Add dropdown selector to Upload Sales panel to choose Online Sales or POS Sales
- [x] Update upload API to handle sale type parameter

## Email Sync Timestamp (Feb 6, 2026)
- [x] Add last sync timestamp display to Email Sync panel
- [x] Store and retrieve last sync time

## Revert and Minimal Timestamp Fix (Feb 6, 2026)
- [ ] Revert GitHub repo to last working commit (before timestamp changes)
- [ ] Add ONLY last sync timestamp text to Email Sync panel — no other changes
- [ ] Verify deployment matches the original interface exactly

## Post-Restore Fixes (Feb 6, 2026)
- [ ] Add dropdown selector back to Upload Sales tab (Online Sales / POS Sales)
- [ ] Verify staff login does NOT show Staff Management data

## Batch Fix (Feb 6, 2026)
- [x] Add dropdown selector to Upload Sales tab (Online Sales / POS Sales)
- [x] Verify staff login does NOT show Staff Management data
- [x] Fix email fetching not working
- [x] Add/update 11 staff members with correct Staff IDs and PINs
- [x] Add month filter to Online Sales and POS Sales tabs for admin
- [x] Fix staff login default panel (show Online Sales, hide Email Sync)

## POS Upload Fix (Feb 6, 2026)
- [ ] Update upload API to handle POS file format (POS Location Name, Date, Order Name, Order ID, Staff name, Payment Gateways, Net Sales, etc.)
- [ ] Skip duplicate records on upload

## Milestone: Cookie Fix + POS Mapping + Staff Filter (Feb 6, 2026)
- [x] Fix cookie domain issue for Railway deployment (public suffix handling)
- [x] POS Sales Channel maps to Column A (POS Location Name)
- [x] POS Sales Payment Gateway maps to Column G (Payment Gateways)
- [x] POS upload parser: handle two-row-per-order format, carry forward Channel/Payment Gateway
- [x] Year to Date filter option for admin in both Online Sales and POS Sales
- [x] Staff Name filter dropdown (admin only) in POS Sales tab
- [x] Staff Name filter dropdown (admin only) in Online Sales tab
- [x] Extract staff from Customer Tags (WVReferredByStaff_STAFFID) for Online Sales
- [x] Filter out staff names without Staff ID from dropdown
- [x] Staff login security: no flash of admin tabs
- [x] Staff view: no month/staff filters, current month data only
- [x] Backfill existing POS records with staff names (1,927 records)
- [x] Backfill existing Online Sales records with staff names (80 records)
- [x] Totals and order counts update dynamically based on staff filter selection

## Login Fix + Sorting Feature (Feb 6, 2026)
- [x] Fix login crash caused by JS quote-escaping bug in sorting onclick handlers
- [x] Use HTML entities (&#39;) instead of literal single quotes in onclick attributes
- [x] Add column sorting to Online Sales (Order Date, Order)
- [x] Add column sorting to POS Sales (Order Date, Order, Channel, Payment Gateway)
- [x] Update nixpacks.toml and railway.json to point to standalone-server-combined.ts
- [x] Restore all features: month/staff filters, Staff Name column, sale type selector, security fixes

## Bug Reports (Feb 6, 2026 - Post Fix)
- [x] Login still not working on Railway deployment (fix ready, needs Publish)
- [x] PIN input fields don't auto-jump to next field (same root cause as login - JS parse error)

## Endpoint Fix (Feb 6, 2026)
- [x] Fix frontend calling /api/auth/pin-login instead of /api/auth/pin (endpoint mismatch)
- [x] Fix Railway build failing due to expo export step (removed unnecessary expo export from build command)
- [x] Successfully deployed fix to Railway via Railway CLI

## Staff Data Restoration (Feb 6, 2026)
- [x] Re-add all 11 staff members with correct Staff IDs and PINs to Railway database (via seed function)
- [x] Verify staff can log in with their PINs

## Railway Data Restoration (Feb 6, 2026)
- [x] Re-add all 11 staff members via startup seed function
- [x] Fix upload failing - caused by authFetch infinite recursion (fetch→authFetch→authFetch...)
- [x] Fix authFetch to use _originalFetch (window.fetch.bind(window)) to avoid recursion
- [x] Fix cookie domain for Railway (public suffix handling)
- [x] Email sync already configured (mschusoapfinance@gmail.com) - Status: Connected and enabled

## Staff Dropdown Cleanup (Feb 6, 2026)
- [x] Remove staff dropdown entries without proper Staff ID (raw IDs like 78022869039, duplicates like "Eva Lee" without ID)
- [x] Only show known staff members: Egenie Tang, Eva Lee, Maggie Liang, Maggie Wong, Ting Siew, Win Lee, Wing Ho, Sharon Li, Hailey Hoi Ling Wong, Bon Lau, Sze

## POS Sales Order Name Fix (Feb 7, 2026)
- [x] Fixed duplicate check: now uses orderNo + orderDate + netSales + saleType combination instead of just orderNo, so different orders with the same Order Name are no longer skipped during import

## Shopify POS Staff View (Feb 7, 2026)
- [x] Build mobile-optimized staff view page at /staff-view route
- [x] Staff PIN login on the staff view page
- [x] Show only logged-in staff's own Online Sales for current month
- [x] Show only logged-in staff's own POS Sales for current month
- [x] Display totals for each category
- [x] Mobile-optimized layout for POS device screen
- [x] Deploy to Railway and provide test URLs

## Staff View Bug Fixes (Feb 7, 2026)
- [x] Fix broken template literal for monthStart calculation (was producing literal string instead of date)
- [x] Fix broken template literal for yearStart calculation (same issue)
- [x] Fix staff sales filtering: match by staffName LIKE '%staffId%' since sales table staffId column is NULL but staffName contains the ID
- [x] Fix staff view API calls to use correct query parameter names (type instead of saleType)

## Missing Online Orders Bug (Feb 7, 2026)
- [x] Investigate why orders 73428, 72957, 72954, 72892 for Eva Lee (78319255599) are missing from Jan 2026 data
- [x] Fix the root cause of missing orders during import (removed netSales === 0 skip, fixed email sync only importing partial data)
- [x] Re-import 173 missing January orders from Excel file
- [x] Update staffName for 59 orders missing staff attribution
- [x] Verify Eva Lee's Jan 2026 Online Sales total: HK$5,085.64 (6 orders)
- [x] Enhanced upload endpoint to extract staff names from Customer Tags (WVReferredByStaff)
- [x] Added bulk staff name update API endpoint (/api/sales/update-staff)

## Upload Reliability Improvement (Feb 7, 2026)
- [x] Investigate why manual Excel upload loses data (root cause: email sync only imported partial report; also netSales===0 skip removed)
- [x] Add upload validation: show expected vs actual row counts after import
- [x] Add detailed upload summary: imported, skipped (duplicates), failed rows with reasons
- [x] Ensure zero-net-sales orders are not skipped during upload
- [x] Add progress/feedback during large file uploads
- [x] Prioritize Net Sales column detection over Total Sales to avoid wrong column matching
- [x] Add admin delete sale endpoint for data cleanup
- [x] Multi-line upload result display with 15s visibility

## Clear & Re-import Feature (Feb 7, 2026)
- [x] Add server endpoint to clear sales by month and sale type
- [x] Add Clear & Re-import button to admin upload panel with month selector
- [x] Add confirmation dialog before clearing data (browser confirm + red warning UI)
- [x] After clearing, automatically import the uploaded file
- [x] Show summary of deleted + imported records with row accounting

## PIN Login Bug Fix (Feb 7, 2026)
- [x] Fix auto-jumping between PIN digit inputs on admin dashboard (Railway HTML) — rewrote to single hidden input + visual dot boxes
- [x] Fix auto-jumping between PIN digit inputs on staff-view page (Railway HTML) — same approach
- [x] Fix auto-jumping between PIN digit inputs on mobile app (Expo pin-login.tsx) — maxLength=1 per input + auto-focus
- [x] Fix auto-login after 4th digit on all three PIN login screens
- [x] Verify admin PIN 9999 works on all three
- [x] Fix JS syntax errors caused by \n inside template literals — rewrote to use array.join('<br>') approach

## Clear & Re-import Button Bug (Feb 7, 2026)
- [x] Fix Clear & Re-import Month button not showing month picker section when clicked
- [x] Add back missing file chooser button (Choose Excel/CSV File)
- [x] Fix parseExcelFile to work with handleFileSelect (XLSX library loading)
- [x] Month picker now shows immediately without requiring file selection first

## Clear & Re-import Sale Type Selector (Feb 7, 2026)
- [x] Add Sale Type dropdown (Online Sales / POS Sales) inside the Clear & Re-import section
- [x] Remove dependency on the upload panel's Sale Type dropdown for clear operations
- [x] Default the clear dropdown to match the upload panel's selection when opening

## File Chooser Button Bug (Feb 7, 2026)
- [x] Fix Choose Excel/CSV File button not opening file picker dialog when clicked — replaced with <label for="fileInput"> pattern

## File Chooser Still Not Working (Feb 7, 2026)
- [x] Replaced button+hidden-input approach with transparent file input overlay technique (opacity:0 input over styled label) — works reliably on iPad Safari and Shopify POS WebView
- [x] Added a dedicated file chooser button inside the Clear & Re-import section
- [x] Both file inputs share the same handleFileSelect handler and update both fileName spans
- [x] Reset all file inputs and file name displays after successful upload or clear-reimport

## Simplify Clear & Re-import Section (Feb 7, 2026)
- [x] Remove file picker from Clear section — no longer needed for clearing data
- [x] Rename to "Clear Month Data" with just month picker and type selector
- [x] Simplify the confirm flow: pick month + type, confirm, backend clears data
- [x] Keep the regular Upload section above for importing new data separately

## Staff Name Missing After Upload (Feb 7, 2026)
- [x] Fix upload endpoint to extract staff names from Customer Tags column (WVReferredByStaff_STAFFID)
- [x] Added server-side fallback: server now parses Customer Tags column directly from CSV in addition to client-side Excel mapping

## Staff Names Only Partially Extracted (Feb 7, 2026)
- [x] Debugged: 77/236 orders had WVReferredByStaff tags; remaining 159 genuinely have no staff attribution
- [x] Replaced hardcoded KNOWN_STAFF map with dynamic lookup from users table
- [x] Unknown staff IDs now stored as 'Unknown Staff ID' instead of being silently dropped
- [x] Email sync now stores staffName alongside staffId for proper display
- [x] Upload result message shows detailed staff attribution stats (client vs server extraction counts)

## Dashboard Logo Update (Feb 7, 2026)
- [x] Generated Ms. Chu brand logo (sage green leaf + soap circle design)
- [x] Replaced soap emoji with logo image on admin dashboard login screen
- [x] Replaced soap emoji with logo image on staff-view login screen
- [x] Deployed to Railway

## Official Logo from Website (Feb 7, 2026)
- [x] Extracted official Ms. Chu logo from mschusoapandbeaut.com (black brush script with water droplets)
- [x] Replaced generated logo with official logo on admin dashboard and staff-view login pages
- [x] Adjusted CSS for horizontal logo format (180px admin, 150px staff-view)
- [x] Deployed to Railway

## Sage Green Background (Feb 7, 2026)
- [x] Changed login background from purple gradient to sage green on admin dashboard
- [x] Changed login background from purple gradient to sage green on staff-view
- [x] Updated all accent colors: buttons, tabs, stat cards, badges, file picker to sage green
- [x] Updated hover states to match sage green palette
- [x] Deployed to Railway

## Dashboard Header Logo (Feb 7, 2026)
- [x] Added Ms. Chu logo (36px height) to admin dashboard header next to user name
- [x] Added Ms. Chu logo (28px height) to staff-view header next to staff name
- [x] Deployed to Railway

## Email Sync Net Sales & Staff Name Fix (Feb 7, 2026)
- [x] Fixed email sync: replaced hardcoded column indices with header-based dynamic detection
- [x] Fixed email sync staff name extraction to use dynamic DB lookup like manual upload
- [x] Email sync now matches manual upload behavior for data consistency
- [x] Deployed to Railway

## New Online Sales Report Format Mapping (Feb 7, 2026)
- [x] Examined new report sample — 16 columns: A=Order Date, B=Order Name, C=Sales Channel, D=Customer Created At, E=Customer Tags, F=Payment Method, G=Email Marketting, H=SMS Marketing, I=Order ID, J-L=ShipAny fields, M=Email, N=Gross Sales, O=Net Sales, P=Total Sales
- [x] Added emailMarketing and smsMarketing columns to the sales database table
- [x] Updated email sync to parse Email Marketing, SMS Marketing, Customer Email, Net Sales with header-based detection
- [x] Updated manual upload to also parse Email Marketing, SMS Marketing, Customer Email columns
- [x] Admin Online Sales table: added Customer Email, Email Mkt, SMS Mkt columns
- [x] Staff-view Online Sales: added Customer Email, Email Mkt, SMS Mkt in order detail rows
- [x] Added customerEmail column to sales database table
- [x] API endpoint updated to return emailMarketing, smsMarketing, customerEmail fields
- [x] Deployed to Railway — everything else stays the same

## Upload Not Showing Data (Feb 7, 2026)
- [ ] Debug why uploaded Jan 2026 Online Sales data shows $0 / 0 orders
- [ ] Check Railway logs for upload errors
- [ ] Check database for inserted records
- [x] Fix the issue — added ALTER TABLE migration for emailMarketing, smsMarketing, customerEmail columns; deployed to Railway

## POS Orders in Online Sales Tab Fix (Feb 7, 2026)
- [ ] Filter out "Point of Sale" channel orders from Online Sales tab during email sync
- [ ] Filter out "Point of Sale" channel orders from Online Sales tab during manual upload
- [ ] Verify Jan 2026 data source (manual upload) and Feb 2026 data source (email auto-fetch)
- [x] Clean up existing Feb 2026 POS orders incorrectly in Online Sales

## Sorting Arrows for Email Mkt and SMS Mkt (Feb 7, 2026)
- [x] Add sorting arrows to Email Mkt column in Online Sales table
- [x] Add sorting arrows to SMS Mkt column in Online Sales table

## Feb 2026 Missing Customer Email / Marketing Data (Feb 8, 2026)
- [x] Investigate why most Feb 2026 orders are missing Customer Email, Email Mkt, SMS Mkt
- [x] Fix: cleared 41 orders missing data, email sync re-imported 61 orders from all 17 emails with full data

## POS Staff View Table Layout (Feb 8, 2026)
- [x] Update POS URL extension staff view to use table layout matching desktop admin view

## Unknown Staff IDs in Feb 2026 Online Sales (Feb 8, 2026)
- [x] Investigate which staff IDs are showing as 'Unknown Staff' (e.g., 90979827995, 101244961051) — confirmed former staff
- [x] Keep 'Unknown Staff [ID]' label as-is per user request

## PIN Login Not Working (Feb 8, 2026)
- [x] Fix PIN input not accepting typing on POS URL extension staff view — replaced hidden input with 4 visible individual inputs
- [x] Fix PIN digit auto-jump not working on Shopify POS browser — added multiple event listeners (input, keyup, keydown) with setTimeout fallbacks
- [x] Replace PIN with single visible input field for Shopify POS browser compatibility
- [x] Fix Login button not working after typing PIN on POS staff view — reverted to 4-square PIN matching admin, fixed _fetch to fetch, fixed pinField to pinInput
- [x] Replace hidden input overlay with 4 visible tappable input boxes (hidden overlay doesn't work on Shopify POS)
- [x] Use simplest possible single password input + Login button for POS staff view (all fancy approaches fail on Shopify POS browser)
- [x] Fix Login API call not working on Shopify POS browser — switched to XMLHttpRequest with absolute URL and detailed error debugging

## Email Auto-Sync Not Running (Feb 8, 2026)
- [x] Fix email auto-sync showing 'Last synced: Never' - removed 1-minute delay, sync runs immediately on startup
