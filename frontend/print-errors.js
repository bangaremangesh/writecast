const r = require('./report.json');
r.forEach(f => {
  f.messages.forEach(m => {
    if(m.severity === 2) {
      console.log(`Line ${m.line}: ${m.message}`);
    }
  });
});
