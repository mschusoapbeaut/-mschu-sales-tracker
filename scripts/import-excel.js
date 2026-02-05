const XLSX = require('xlsx');
const fs = require('fs');

// Read the Excel file
const workbook = XLSX.readFile('sample-report.xlsx');
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(sheet);

// Staff ID mapping from database
const staffMapping = {
  '78319321135': 1,  // Egenie Tang
  '78319255599': 2,  // Eva Lee
  '78319190063': 3,  // Maggie Liang
  '79208775727': 4,  // Maggie Wong
  '78319386671': 5,  // Ting Siew
  '78319550511': 6,  // Win Lee
  '78319091759': 7,  // Wing Ho
  '101232115995': 8, // Sharon Li
  '109111279899': 9, // Hailey Hoi Ling Wong
  '111913632027': 10, // Bon Lau
  '118809198875': 11, // Sze
};

const staffNames = {
  '78319321135': 'Egenie Tang',
  '78319255599': 'Eva Lee',
  '78319190063': 'Maggie Liang',
  '79208775727': 'Maggie Wong',
  '78319386671': 'Ting Siew',
  '78319550511': 'Win Lee',
  '78319091759': 'Wing Ho',
  '101232115995': 'Sharon Li',
  '109111279899': 'Hailey Hoi Ling Wong',
  '111913632027': 'Bon Lau',
  '118809198875': 'Sze',
};

const records = [];
const warnings = [];
const unmappedStaffIds = new Set();

data.forEach((row, idx) => {
  const tags = row['Customer Tags'] || '';
  const match = tags.match(/WVReferredByStaff_(\d+)/);
  
  if (match === null) {
    return; // Skip rows without staff tag
  }
  
  const staffId = match[1];
  const userId = staffMapping[staffId];
  
  if (userId === undefined) {
    unmappedStaffIds.add(staffId);
    warnings.push(`Row ${idx + 2}: Unknown staff ID ${staffId}`);
    return;
  }
  
  // Use Net Sales instead of Total Sales
  const netSales = parseFloat(row['Net Sales']) || 0;
  if (netSales <= 0) {
    return; // Skip zero sales
  }
  
  records.push({
    userId,
    staffName: staffNames[staffId],
    orderDate: row['Order Date'],
    orderName: row['Order Name'],
    salesChannel: row['Sales Channel'],
    netSales: netSales, // Use Net Sales
    totalSales: row['Total Sales'],
    refundAdj: row['Refund Adjustment Amount'] || 0
  });
});

console.log('=== Import Summary (Using Net Sales) ===');
console.log(`Total rows in file: ${data.length}`);
console.log(`Records to import: ${records.length}`);
console.log(`Warnings: ${warnings.length}`);
console.log(`Unmapped staff IDs: ${Array.from(unmappedStaffIds).join(', ') || 'None'}`);

// Group by staff
const byStaff = {};
records.forEach(r => {
  if (byStaff[r.staffName] === undefined) {
    byStaff[r.staffName] = { count: 0, total: 0 };
  }
  byStaff[r.staffName].count++;
  byStaff[r.staffName].total += r.netSales;
});

console.log('\n=== Net Sales by Staff ===');
Object.entries(byStaff).sort((a,b) => b[1].total - a[1].total).forEach(([name, data]) => {
  console.log(`${name}: ${data.count} orders, HK$${data.total.toLocaleString()}`);
});

// Calculate total
const grandTotal = records.reduce((sum, r) => sum + r.netSales, 0);
console.log(`\nGrand Total (Net Sales): HK$${grandTotal.toLocaleString()}`);

// Save records for import
fs.writeFileSync('import-records.json', JSON.stringify(records, null, 2));
console.log('\nRecords saved to import-records.json');

// Output warnings
if (warnings.length > 0) {
  console.log('\n=== Warnings ===');
  warnings.forEach(w => console.log(w));
}
