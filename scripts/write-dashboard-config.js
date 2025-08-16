// Writes dashboard/config.js based on environment variables
// Usage (PowerShell): node scripts/write-dashboard-config.js
const fs = require('fs');
const path = require('path');

const API_BASE = process.env.DASHBOARD_API_BASE || '';
const WS_BASE = process.env.DASHBOARD_WS_BASE || '';

const outDir = path.join(__dirname, '..', 'dashboard');
const outFile = path.join(outDir, 'config.js');

const content = [
  '// Generated at build/deploy time. Do not edit manually.\n',
  'window.API_BASE = ', JSON.stringify(API_BASE), ';\n',
  'window.WS_BASE = ', JSON.stringify(WS_BASE), ';\n',
].join('');

fs.writeFileSync(outFile, content);
console.log(`Wrote ${outFile} with API_BASE=${API_BASE || '(default)'} WS_BASE=${WS_BASE || '(default)'}`);
