/**
 * Algo Vista Bots - Main Entry Point
 */

import 'dotenv/config';

// Export all modules
export * as cex from './crypto/cex';

// Main entry point
async function main() {
    console.log('🤖 Algo Vista Bots');
    console.log('Trading bot system initialized');
    console.log('Environment:', process.env.NODE_ENV || 'development');
}

// Run if this is the main module
if (require.main === module) {
    main().catch(console.error);
}

export default main;
