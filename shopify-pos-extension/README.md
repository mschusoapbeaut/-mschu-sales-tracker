# Ms. Chu Sales Tracker - Shopify POS Extension

This extension adds a tile to Shopify POS that links to the Ms. Chu Sales Tracker app.

## Setup Instructions

### Prerequisites
1. A Shopify Partner account
2. A development store for testing
3. Shopify CLI installed (`npm install -g @shopify/cli`)

### Step 1: Create a Shopify App

1. Go to your [Shopify Partner Dashboard](https://partners.shopify.com)
2. Click "Apps" → "Create app"
3. Choose "Create app manually"
4. Enter app name: "Ms. Chu Sales Tracker"
5. Note down your **API key** and **API secret key**

### Step 2: Configure App URLs

In your app settings, set:
- **App URL**: `https://8081-ilnl7t4rksqbdrhkhs6af-bca28d7a.sg1.manus.computer/pin-login`
- **Allowed redirection URL(s)**: `https://8081-ilnl7t4rksqbdrhkhs6af-bca28d7a.sg1.manus.computer/pin-login`

### Step 3: Enable POS Extension

1. In your app settings, go to "Extensions"
2. Click "Create extension"
3. Select "POS UI extension"
4. Name it "Sales Tracker Tile"

### Step 4: Configure POS Tile

The POS tile will open the Sales Tracker app in a browser/webview.
Staff can then enter their 4-digit PIN to view their personal sales dashboard.

### Step 5: Install on Development Store

1. In your Partner Dashboard, go to your app
2. Click "Select store" and choose your development store
3. Click "Install app"

### Step 6: Enable in Shopify POS

1. Open Shopify POS on your device
2. Go to Settings → Apps
3. Enable "Ms. Chu Sales Tracker"
4. The tile will appear on your POS home screen

## Usage

1. Tap the "Sales Tracker" tile in Shopify POS
2. Enter your 4-digit PIN (same as your POS login PIN)
3. View your personal sales dashboard

## Setting Up Staff PINs

Staff members need to set their PIN in the app:
1. Log in to the app using Manus authentication
2. Go to Profile tab
3. Find "POS Login PIN" section
4. Set a 4-digit PIN

This PIN can match their Shopify POS PIN for convenience.

## Production Deployment

When ready for production:
1. Update the App URL to your production domain
2. Submit the app for review (if publishing to Shopify App Store)
3. Or install as a custom app on your store

## Support

For issues or questions, contact the Ms. Chu Soap & Beaut team.
