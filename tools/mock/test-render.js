const m = require('./mock-data');
const a = m.renderEffect();
console.log('len', a.length);
console.log(a.slice(0,80).join(','));
