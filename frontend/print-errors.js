import { readFileSync } from 'node:fs';

const reportPath = new URL('./report.json', import.meta.url);
const report = JSON.parse(readFileSync(reportPath, 'utf8'));

report.forEach(f => {
  f.messages.forEach(m => {
    if(m.severity === 2) {
      console.log(`Line ${m.line}: ${m.message}`);
    }
  });
});
