/**
 * CLI Script to test the API fallback mechanisms
 * 
 * Usage:
 * npx ts-node scripts/test-api-fallback.ts [symbol]
 * 
 * Example:
 * npx ts-node scripts/test-api-fallback.ts AAPL
 */

import { runAllTests } from '../app/utils/test-api-fallback';

async function main() {
  try {
    // Get the stock symbol from command line args or use default
    const symbol = process.argv[2] || 'AAPL';
    
    console.log(`Starting API fallback tests for symbol: ${symbol}`);
    await runAllTests(symbol);
    
    console.log('\nTests completed successfully.');
  } catch (error) {
    console.error('Error running tests:', error);
    process.exit(1);
  }
}

// Run the main function
main().catch(error => {
  console.error('Uncaught error:', error);
  process.exit(1);
}); 