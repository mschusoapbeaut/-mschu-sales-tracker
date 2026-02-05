-- Ms. Chu Sales Tracker - Database Seed Data
-- Generated for Railway deployment
-- Run this after creating tables with drizzle migrations

-- Users table data (11 staff + admin)
-- Note: openId is a unique identifier for each user in standalone mode
INSERT INTO users (openId, name, email, loginMethod, role, staffId, pin, monthlyTarget) VALUES
('admin-cindy', 'Cindy Chu', 'cindychu@mschusoapandbeaut.com', 'pin', 'admin', '78319091759', '9999', '0.00'),
('staff-wing', 'Wing Ho', 'wingho@mschusoapandbeaut.com', 'pin', 'user', '78319091759', '1234', '0.00'),
('staff-kiki', 'Kiki Chan', 'kikichan@mschusoapandbeaut.com', 'pin', 'user', '78319222831', '2345', '0.00'),
('staff-fiona', 'Fiona Leung', 'fionaleung@mschusoapandbeaut.com', 'pin', 'user', '78319353903', '3456', '0.00'),
('staff-mandy', 'Mandy Wong', 'mandywong@mschusoapandbeaut.com', 'pin', 'user', '78319484975', '4567', '0.00'),
('staff-cherry', 'Cherry Lam', 'cherrylam@mschusoapandbeaut.com', 'pin', 'user', '78319616047', '5678', '0.00'),
('staff-joey', 'Joey Yip', 'joeyyip@mschusoapandbeaut.com', 'pin', 'user', '78319747119', '6789', '0.00'),
('staff-kelly', 'Kelly Ng', 'kellyng@mschusoapandbeaut.com', 'pin', 'user', '78319878191', '7890', '0.00'),
('staff-vivian', 'Vivian Lee', 'vivianlee@mschusoapandbeaut.com', 'pin', 'user', '78320009263', '8901', '0.00'),
('staff-grace', 'Grace Tam', 'gracetam@mschusoapandbeaut.com', 'pin', 'user', '78320140335', '9012', '0.00'),
('staff-amy', 'Amy Chow', 'amychow@mschusoapandbeaut.com', 'pin', 'user', '78320271407', '0123', '0.00')
ON DUPLICATE KEY UPDATE name=VALUES(name), email=VALUES(email), staffId=VALUES(staffId), pin=VALUES(pin);

-- Staff PIN Reference:
-- Cindy Chu (Admin): 9999
-- Wing Ho: 1234
-- Kiki Chan: 2345
-- Fiona Leung: 3456
-- Mandy Wong: 4567
-- Cherry Lam: 5678
-- Joey Yip: 6789
-- Kelly Ng: 7890
-- Vivian Lee: 8901
-- Grace Tam: 9012
-- Amy Chow: 0123
