/**
 * Test utility for verifying API fallback mechanisms
 * This file provides functions to test the fallback between Finnhub and Alpha Vantage
 */

import { 
  getStockData, 
  getCompanyNewsWithFallback, 
  getCompanyProfileWithFallback,
  configureStockAPI,
  PROVIDERS 
} from './stock-api';
import { setRateLimited } from './cache';

/**
 * Test the stock data API with various configurations
 */
export async function testStockDataAPI(symbol: string) {
  console.log('========== TESTING STOCK DATA API ==========');
  
  try {
    // Test with Alpha Vantage as primary
    console.log('\n1. Testing with Alpha Vantage as primary:');
    configureStockAPI({
      preferredOHLCProvider: PROVIDERS.ALPHA_VANTAGE,
      enableFallback: true
    });
    
    let data = await getStockData(symbol);
    console.log(`Success! Got ${data.timeSeriesData.length} data points`);
    
    // Test with Finnhub as primary
    console.log('\n2. Testing with Finnhub as primary:');
    configureStockAPI({
      preferredOHLCProvider: PROVIDERS.FINNHUB,
      enableFallback: true
    });
    
    data = await getStockData(symbol);
    console.log(`Success! Got ${data.timeSeriesData.length} data points`);
    
    // Test with fallback disabled
    console.log('\n3. Testing with fallback disabled:');
    configureStockAPI({
      preferredOHLCProvider: PROVIDERS.ALPHA_VANTAGE,
      enableFallback: false
    });
    
    data = await getStockData(symbol);
    console.log(`Success! Got ${data.timeSeriesData.length} data points`);
    
    // Test with rate limiting
    console.log('\n4. Testing with rate limiting:');
    setRateLimited(true);
    
    data = await getStockData(symbol);
    console.log(`Success! Got ${data.timeSeriesData.length} data points from cache`);
    
    // Reset rate limiting
    setRateLimited(false);
    
    console.log('\nAll stock data API tests passed!');
    return true;
  } catch (error) {
    console.error('Stock data API test failed:', error);
    return false;
  }
}

/**
 * Test the company news API with various configurations
 */
export async function testNewsAPI(symbol: string) {
  console.log('\n========== TESTING NEWS API ==========');
  
  try {
    // Test with Finnhub as primary
    console.log('\n1. Testing with Finnhub as primary:');
    configureStockAPI({
      preferredNewsProvider: PROVIDERS.FINNHUB,
      enableFallback: true
    });
    
    let news = await getCompanyNewsWithFallback(symbol);
    console.log(`Success! Got ${news.length} news items`);
    
    // Test with Alpha Vantage as primary
    console.log('\n2. Testing with Alpha Vantage as primary:');
    configureStockAPI({
      preferredNewsProvider: PROVIDERS.ALPHA_VANTAGE,
      enableFallback: true
    });
    
    news = await getCompanyNewsWithFallback(symbol);
    console.log(`Success! Got ${news.length} news items`);
    
    // Test with fallback disabled
    console.log('\n3. Testing with fallback disabled:');
    configureStockAPI({
      preferredNewsProvider: PROVIDERS.FINNHUB,
      enableFallback: false
    });
    
    news = await getCompanyNewsWithFallback(symbol);
    console.log(`Success! Got ${news.length} news items`);
    
    console.log('\nAll news API tests passed!');
    return true;
  } catch (error) {
    console.error('News API test failed:', error);
    return false;
  }
}

/**
 * Test the company profile API with various configurations
 */
export async function testCompanyProfileAPI(symbol: string) {
  console.log('\n========== TESTING COMPANY PROFILE API ==========');
  
  try {
    // Test with default configuration (Finnhub primary)
    console.log('\n1. Testing with default configuration:');
    configureStockAPI({
      enableFallback: true
    });
    
    let profile = await getCompanyProfileWithFallback(symbol);
    console.log(`Success! Got profile for ${profile.name}`);
    
    // Test with fallback disabled
    console.log('\n2. Testing with fallback disabled:');
    configureStockAPI({
      enableFallback: false
    });
    
    profile = await getCompanyProfileWithFallback(symbol);
    console.log(`Success! Got profile for ${profile.name}`);
    
    // Test with rate limiting
    console.log('\n3. Testing with rate limiting:');
    setRateLimited(true);
    
    profile = await getCompanyProfileWithFallback(symbol);
    console.log(`Success! Got profile for ${profile.name} from cache`);
    
    // Reset rate limiting
    setRateLimited(false);
    
    console.log('\nAll company profile API tests passed!');
    return true;
  } catch (error) {
    console.error('Company profile API test failed:', error);
    return false;
  }
}

/**
 * Run all tests
 */
export async function runAllTests(symbol: string = 'AAPL') {
  console.log(`\n===== STARTING API FALLBACK TESTS FOR ${symbol} =====\n`);
  
  const stockDataResult = await testStockDataAPI(symbol);
  const newsResult = await testNewsAPI(symbol);
  const profileResult = await testCompanyProfileAPI(symbol);
  
  console.log('\n===== TEST SUMMARY =====');
  console.log(`Stock Data API: ${stockDataResult ? 'PASSED' : 'FAILED'}`);
  console.log(`News API: ${newsResult ? 'PASSED' : 'FAILED'}`);
  console.log(`Company Profile API: ${profileResult ? 'PASSED' : 'FAILED'}`);
  console.log(`Overall: ${stockDataResult && newsResult && profileResult ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
}

// To run the tests, uncomment this line and execute this file directly:
// runAllTests('AAPL').catch(console.error); 