/**
 * Client-side API utilities that leverage the unified API with fallback mechanisms
 * This file provides simple functions for React components to fetch stock data
 */

import { getStockData, getCompanyNewsWithFallback, getCompanyProfileWithFallback } from './stock-api';
import { checkRateLimit } from './cache';

/**
 * Fetch stock data for a given symbol
 * @param symbol Stock symbol (e.g., AAPL)
 * @returns Promise with stock data including OHLC time series
 */
export async function fetchStockData(symbol: string) {
  try {
    // Check if we're currently rate limited
    if (checkRateLimit()) {
      console.log('Using cached data due to rate limits');
    }
    
    return await getStockData(symbol);
  } catch (error) {
    console.error('Error fetching stock data:', error);
    throw new Error(`Failed to fetch stock data for ${symbol}`);
  }
}

/**
 * Fetch company news for a given symbol
 * @param symbol Stock symbol (e.g., AAPL)
 * @returns Promise with array of news items
 */
export async function fetchCompanyNews(symbol: string) {
  try {
    // Check if we're currently rate limited
    if (checkRateLimit()) {
      console.log('Using cached news due to rate limits');
    }
    
    return await getCompanyNewsWithFallback(symbol);
  } catch (error) {
    console.error('Error fetching company news:', error);
    return []; // Return empty array instead of throwing to avoid breaking UI
  }
}

/**
 * Fetch company profile for a given symbol
 * @param symbol Stock symbol (e.g., AAPL)
 * @returns Promise with company profile data
 */
export async function fetchCompanyProfile(symbol: string) {
  try {
    // Check if we're currently rate limited
    if (checkRateLimit()) {
      console.log('Using cached profile due to rate limits');
    }
    
    return await getCompanyProfileWithFallback(symbol);
  } catch (error) {
    console.error('Error fetching company profile:', error);
    throw new Error(`Failed to fetch company profile for ${symbol}`);
  }
}

/**
 * Configure client API preferences
 * @param options Configuration options
 */
export function configureClientAPI(options: {
  preferPrimaryProvider?: boolean;
  enableCaching?: boolean;
}) {
  // Here you could add client-specific configuration
  // For now, we're just logging the options
  console.log('Client API configured with options:', options);
  // In a real implementation, you might store these in localStorage
  // or pass them to the unified API configuration
} 