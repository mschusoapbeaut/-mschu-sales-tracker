# Ms. Chu Sales Tracker - Railway Deployment Guide

This guide walks you through deploying the Ms. Chu Sales Tracker app to Railway.

## Prerequisites

1. A [Railway account](https://railway.app) (free tier available)
2. A GitHub account (for easiest deployment)

## Quick Start (Recommended)

### Step 1: Push Code to GitHub

1. Create a new repository on GitHub (e.g., `mschu-sales-tracker`)
2. Push this code to your repository:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/mschu-sales-tracker.git
   git push -u origin main
   ```

### Step 2: Create Railway Project

1. Go to [Railway Dashboard](https://railway.app/dashboard)
2. Click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Choose your `mschu-sales-tracker` repository
5. Railway will automatically detect the Dockerfile and start building

### Step 3: Add MySQL Database

1. In your Railway project, click **"+ New"**
2. Select **"Database"** → **"MySQL"**
3. Wait for the database to provision

### Step 4: Configure Environment Variables

In your Railway project settings, add these environment variables:

| Variable | Value | Description |
|----------|-------|-------------|
| `DATABASE_URL` | `${{MySQL.DATABASE_URL}}` | Auto-linked from MySQL service |
| `JWT_SECRET` | Generate a random 32+ character string | Session encryption key |
| `NODE_ENV` | `production` | Production mode |
| `PORT` | `3000` | Server port (Railway sets this automatically) |

**For Google Drive sync (optional):**
| Variable | Value |
|----------|-------|
| `GOOGLE_CLIENT_ID` | Your Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Your Google OAuth Client Secret |
| `GOOGLE_REDIRECT_URI` | `https://YOUR_RAILWAY_URL/api/auth/google/callback` |

### Step 5: Run Database Migrations

1. Open Railway's **"Deploy"** tab
2. Click on your service
3. Go to **"Settings"** → **"Deploy"**
4. Add a one-time deploy command:
   ```bash
   pnpm db:push
   ```
5. Or connect to the database and run the SQL in `scripts/seed-data.sql`

### Step 6: Seed Initial Data

Connect to your MySQL database using the credentials from Railway and run:
```sql
-- Run the contents of scripts/seed-data.sql
```

### Step 7: Generate Domain

1. Go to your service **"Settings"**
2. Click **"Networking"** → **"Generate Domain"**
3. You'll get a URL like: `https://mschu-sales-tracker-production.up.railway.app`

## Staff PIN Codes

After deployment, staff can log in with these PINs:

| Staff Member | PIN |
|--------------|-----|
| Cindy Chu (Admin) | 9999 |
| Wing Ho | 1234 |
| Kiki Chan | 2345 |
| Fiona Leung | 3456 |
| Mandy Wong | 4567 |
| Cherry Lam | 5678 |
| Joey Yip | 6789 |
| Kelly Ng | 7890 |
| Vivian Lee | 8901 |
| Grace Tam | 9012 |
| Amy Chow | 0123 |

## Shopify POS Integration

After deployment:

1. Go to Shopify Admin → **Settings** → **Point of Sale**
2. Add a **Custom Tile** with:
   - Name: "Sales Tracker"
   - URL: `https://YOUR_RAILWAY_URL/pin-login`
3. Staff can tap the tile and enter their PIN to view their sales

## Updating Google OAuth

If using Google Drive sync:

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Navigate to **APIs & Services** → **Credentials**
3. Edit your OAuth 2.0 Client
4. Add your Railway URL to **Authorized redirect URIs**:
   - `https://YOUR_RAILWAY_URL/api/auth/google/callback`

## Troubleshooting

### App won't start
- Check Railway logs for errors
- Verify `DATABASE_URL` is correctly set
- Ensure `JWT_SECRET` is set

### Database connection fails
- Verify MySQL service is running
- Check `DATABASE_URL` format: `mysql://user:pass@host:port/database`

### PIN login not working
- Run the seed SQL to create user accounts
- Verify users exist in the database

## Cost Estimate

Railway Free Tier includes:
- $5 credit per month
- Sufficient for small apps like this

Estimated monthly cost: **$0 - $5** (within free tier for typical usage)

## Support

For issues with this deployment, check:
1. Railway documentation: https://docs.railway.app
2. Railway Discord community

---

*Ms. Chu Sales Tracker - Natural skincare for all skin types*
