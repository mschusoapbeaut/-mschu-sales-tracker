const fs = require('fs');
const records = JSON.parse(fs.readFileSync('import-records.json', 'utf8'));

// Group by staff
const byStaff = {};
records.forEach(r => {
  if (byStaff[r.staffName] === undefined) {
    byStaff[r.staffName] = { orders: [], total: 0 };
  }
  
  let dateStr;
  if (typeof r.orderDate === 'number') {
    const excelEpoch = new Date(1899, 11, 30);
    const jsDate = new Date(excelEpoch.getTime() + r.orderDate * 86400000);
    dateStr = jsDate.toISOString().slice(0, 10);
  } else {
    dateStr = new Date(r.orderDate).toISOString().slice(0, 10);
  }
  
  byStaff[r.staffName].orders.push({
    date: dateStr,
    orderName: String(r.orderName).replace(/\.0$/, ''),
    channel: r.salesChannel,
    netSales: r.netSales
  });
  byStaff[r.staffName].total += r.netSales;
});

// Sort by total descending
const sorted = Object.entries(byStaff).sort((a, b) => b[1].total - a[1].total);

sorted.forEach(([name, data]) => {
  console.log('');
  console.log('**' + name + '** (' + data.orders.length + ' orders) - **HK$' + data.total.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + '**');
  console.log('| Order Date | Order Name | Sales Channel | Net Sales (HK$) |');
  console.log('|------------|------------|---------------|-----------------|');
  
  data.orders.sort((a, b) => a.date.localeCompare(b.date) || a.orderName.localeCompare(b.orderName));
  data.orders.forEach(o => {
    console.log('| ' + o.date + ' | ' + o.orderName + ' | ' + o.channel + ' | ' + o.netSales.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' |');
  });
});

// Summary
console.log('');
console.log('---');
console.log('');
console.log('**Summary by Staff:**');
console.log('| Staff Name | Orders | Net Sales (HK$) |');
console.log('|------------|--------|-----------------|');
let totalOrders = 0;
let grandTotal = 0;
sorted.forEach(([name, data]) => {
  console.log('| ' + name + ' | ' + data.orders.length + ' | ' + data.total.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' |');
  totalOrders += data.orders.length;
  grandTotal += data.total;
});
console.log('| **TOTAL** | **' + totalOrders + '** | **' + grandTotal.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + '** |');
