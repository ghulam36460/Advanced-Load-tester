// DEPRECATED: app-fixed.js
// This file is deprecated. Please use app.js as the main entry point.
// Keeping this stub to avoid confusion if referenced; it will exit with a clear message.

if (require.main === module) {
    console.error('\n[DEPRECATED] app-fixed.js is no longer used. Please run: node app.js');
    process.exit(1);
}

module.exports = function Deprecated() {
    throw new Error('app-fixed.js is deprecated. Use app.js instead.');
};
