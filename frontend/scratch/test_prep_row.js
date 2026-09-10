const PDFDocument = require('pdfkit-table');
const fs = require('fs');
const doc = new PDFDocument();
const table = {
  headers: ['Col A', 'Col B'],
  rows: [['Row 1 A', 'Row 1 B']]
};
doc.table(table, {
  prepareRow: (...args) => {
    console.log('prepareRow args length:', args.length);
    args.forEach((arg, i) => {
      console.log(`arg ${i}:`, typeof arg, arg ? arg.constructor.name : 'null');
      if (typeof arg === 'object' && arg) {
        console.log('  keys:', Object.keys(arg));
      }
    });
  }
});
doc.end();
