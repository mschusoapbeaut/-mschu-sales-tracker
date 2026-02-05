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
