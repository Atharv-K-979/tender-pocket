const fs = require('fs');

const content = fs.readFileSync('scratch/tender-page-chunk.js', 'utf8');

const targets = ['41614:', '41614:function'];
targets.forEach(t => {
  const index = content.indexOf(t);
  if (index !== -1) {
    console.log(`Found "${t}" at index ${index}`);
    console.log(content.slice(index, index + 2500));
  } else {
    console.log(`"${t}" not found.`);
  }
});
