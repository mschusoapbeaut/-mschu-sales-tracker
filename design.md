# Ms. Chu Sales Tracker - Design Document

## Overview

A mobile app for Ms. Chu Soap & Beaut team members to track their individual sales performance. The app features multi-user authentication, a personalized sales dashboard, and admin capabilities for uploading sales reports.

## Target Platform

- **Orientation**: Portrait (9:16)
- **Usage**: One-handed mobile operation
- **Design Language**: iOS Human Interface Guidelines (HIG) compliant

---

## Screen List

### 1. Login Screen
- Email/password authentication form
- Clean, branded login interface
- "Remember me" option
- Error handling for invalid credentials

### 2. Home Dashboard
- Welcome message with user name
- Key performance indicators (KPIs) at a glance:
  - Total Sales (current month)
  - Number of Orders
  - Average Order Value
  - Sales Target Progress
- Quick stats cards with icons
- Period selector (This Week / This Month / This Year)

### 3. Sales Details Screen
- Detailed sales breakdown by product
- Sales trend chart (line/bar chart)
- Top-selling products list
- Recent transactions list

### 4. Profile Screen
- User profile information
- Sales performance summary
- Logout option

### 5. Admin Panel (Admin users only)
- Upload sales report (CSV/Excel)
- View all users' performance summary
- User management (view registered users)

---

## Primary Content and Functionality

### Home Dashboard Content
| Element | Data Type | Description |
|---------|-----------|-------------|
| Total Sales | Currency (HKD) | Sum of all sales for selected period |
| Order Count | Number | Total number of orders |
| Avg Order Value | Currency (HKD) | Total sales / Order count |
| Target Progress | Percentage | Current sales vs. monthly target |
| Recent Sales | List | Last 5 transactions |

### Sales Details Content
| Element | Data Type | Description |
|---------|-----------|-------------|
| Product Breakdown | Table | Sales by product category |
| Sales Trend | Chart | Daily/weekly sales over time |
| Top Products | Ranked List | Best-selling items |
| Transactions | List | Individual sale records |

### Admin Panel Content
| Element | Data Type | Description |
|---------|-----------|-------------|
| Report Upload | File Input | CSV/Excel file picker |
| Team Overview | Table | All users' sales summaries |
| User List | List | Registered team members |

---

## Key User Flows

### Flow 1: User Login
1. User opens app → Login Screen
2. User enters email and password
3. User taps "Sign In" button
4. System validates credentials
5. Success → Navigate to Home Dashboard
6. Failure → Show error message, stay on Login

### Flow 2: View Sales Performance
1. User on Home Dashboard
2. User sees KPI cards with current month data
3. User taps period selector to change timeframe
4. Dashboard updates with new period data
5. User taps "View Details" → Sales Details Screen

### Flow 3: Admin Upload Report
1. Admin user taps Profile tab
2. Admin sees "Admin Panel" option
3. Admin taps "Upload Report"
4. System opens file picker (CSV/Excel)
5. Admin selects file
6. System parses and imports data
7. Success → Show confirmation with import summary
8. Failure → Show error with details

### Flow 4: View Product Breakdown
1. User on Home Dashboard
2. User taps "Sales Details" or navigates to Details tab
3. User sees product-wise sales breakdown
4. User can scroll through product list
5. User sees sales trend chart

---

## Color Choices

Based on Ms. Chu Soap & Beaut brand identity (natural, organic, earthy tones):

| Token | Light Mode | Dark Mode | Usage |
|-------|------------|-----------|-------|
| primary | #2D5A3D | #4A8C5E | Main accent, buttons, links |
| background | #FDFBF7 | #1A1A1A | Screen backgrounds |
| surface | #F5F2EB | #252525 | Cards, elevated surfaces |
| foreground | #2C2C2C | #F5F2EB | Primary text |
| muted | #7A7A7A | #A0A0A0 | Secondary text |
| border | #E5E0D5 | #3A3A3A | Dividers, borders |
| success | #4A8C5E | #5DA36E | Positive metrics, growth |
| warning | #D4A84B | #E5B95C | Alerts, caution |
| error | #C45C5C | #E07070 | Errors, negative trends |

The color palette reflects:
- **Green tones**: Natural, organic brand identity
- **Warm neutrals**: Earthy, approachable feel
- **Cream backgrounds**: Soft, premium appearance

---

## Component Specifications

### KPI Card
- Rounded corners (16px)
- Subtle shadow
- Icon on left, value on right
- Trend indicator (up/down arrow with percentage)

### Sales Chart
- Line chart for trends
- Bar chart for comparisons
- Touch-interactive data points
- Period labels on x-axis

### Transaction List Item
- Product name and quantity
- Sale amount (bold)
- Date and time
- Chevron for detail navigation

---

## Navigation Structure

```
Tab Bar Navigation:
├── Home (Dashboard)
├── Sales (Details)
└── Profile
    └── Admin Panel (conditional)
```

---

## Accessibility Considerations

- Minimum touch target: 44x44 points
- High contrast text on all backgrounds
- Clear visual hierarchy
- Loading states for all async operations
- Error messages with actionable guidance
