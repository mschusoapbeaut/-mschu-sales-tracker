const fs = require('fs');

// Read the processed records
const records = JSON.parse(fs.readFileSync('import-records.json', 'utf8'));

// Generate SQL INSERT statements using Net Sales
const values = records.map(r => {
  // Handle Excel date serial number
  let dateStr;
  if (typeof r.orderDate === 'number') {
    // Excel date serial number - convert to JS date
    // Excel dates start from 1900-01-01 (serial 1)
    const excelEpoch = new Date(1899, 11, 30); // Dec 30, 1899
    const jsDate = new Date(excelEpoch.getTime() + r.orderDate * 86400000);
    dateStr = jsDate.toISOString().slice(0, 19).replace('T', ' ');
  } else {
    const orderDate = new Date(r.orderDate);
    dateStr = orderDate.toISOString().slice(0, 19).replace('T', ' ');
  }
  
  const orderRef = String(r.orderName).replace(/\.0$/, '');
  
  // Use netSales instead of totalSales
  return `(${r.userId}, 'Online Sale', '${r.salesChannel}', 1, ${r.netSales.toFixed(2)}, ${r.netSales.toFixed(2)}, '${dateStr}', NULL, '${orderRef}', NOW())`;
}).join(',\n  ');

const sql = `INSERT INTO sales (userId, productName, productCategory, quantity, unitPrice, totalAmount, saleDate, customerName, orderReference, createdAt)
VALUES
  ${values};`;

console.log(sql);
