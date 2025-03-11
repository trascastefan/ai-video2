/**
 * Unified Stock API Client with Fallback Mechanisms
 * 
 * This file provides a unified interface for fetching stock data from multiple providers,
 * with automatic fallback between Finnhub and Alpha Vantage.
 */

import { getStockCandles, getCompanyNews, formatDateYYYYMMDD } from './finnhub';
import { getDailyTimeSeries, DailyData } from './alphavantage';
import { finnhubQueue, alphaVantageQueue } from './request-queue';
import { companyDataCache, isRateLimited, setRateLimited } from './cache';
import { retryWhenRateLimited, isRateLimitError } from './retry-helper';

// ===== Interfaces =====

export interface NewsItem {
  date: string;
  title: string;
  source: string;
  url: string;
  summary?: string;
}

export interface OHLCData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  percentageChange: number;
  direction: 'up' | 'down';
}

export interface StockDataResult {
  timeSeriesData: OHLCData[];
  significantMoves: OHLCData[];
}

export interface APIProvider {
  name: string;
  priority: number;
}

export interface CompanyProfile {
  name: string;
  description: string;
  marketCap: number;
  volume: number;
  sector: string;
  industry: string;
}

// ===== Configuration =====

export const PROVIDERS = {
  ALPHA_VANTAGE: { name: 'AlphaVantage', priority: 1 },
  FINNHUB: { name: 'Finnhub', priority: 2 }
} as const;

interface StockAPIConfig {
  preferredOHLCProvider: {
    name: string;
  };
  preferredNewsProvider: APIProvider;
  enableFallback: boolean;
  cacheResults: boolean;
  logApiCalls: boolean;
  alphaVantageConfig: {
    apiKey: string | string[];
  };
  finnhubConfig: {
    apiKey: string | string[];
  };
}

// Default configuration
const defaultConfig: StockAPIConfig = {
  preferredOHLCProvider: PROVIDERS.FINNHUB,
  preferredNewsProvider: PROVIDERS.FINNHUB,
  enableFallback: true,
  cacheResults: true,
  logApiCalls: true,
  alphaVantageConfig: {
    apiKey: process.env.ALPHA_VANTAGE_API_KEY || ''
  },
  finnhubConfig: {
    apiKey: process.env.FINNHUB_API_KEY || ''
  }
};

// Current configuration (mutable)
let currentConfig: StockAPIConfig = { ...defaultConfig };

// Configuration functions
export function updateConfig(newConfig: Partial<StockAPIConfig>) {
  currentConfig = {
    ...currentConfig,
    ...newConfig
  };
}

export function resetConfig() {
  currentConfig = { ...defaultConfig };
}

// Update queue types
interface QueuedFunction<T> {
  (): Promise<T>;
}

interface APIRequestQueue {
  add<T>(fn: QueuedFunction<T>): Promise<T>;
  enqueue<T>(fn: QueuedFunction<T>): Promise<T>;
}

// ===== Utility Functions =====

/**
 * Enhanced logging function
 */
function logApi(message: string, level: 'info' | 'warn' | 'error' = 'info', details?: any) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
  
  // Log to console with appropriate level
  if (level === 'error') {
    console.error(logMessage);
    if (details) console.error('Details:', details);
  } else if (level === 'warn') {
    console.warn(logMessage);
    if (details) console.warn('Details:', details);
  } else {
    console.log(logMessage);
    if (details) console.log('Details:', details);
  }
  
  // In a production environment, you might want to:
  // 1. Store logs in localStorage for debugging
  // 2. Send logs to a server
  // 3. Maintain a rolling log buffer
}

/**
 * Check if data is in cache
 */
function checkCache(symbol: string): any {
  if (currentConfig.cacheResults) {
    const cachedData = companyDataCache.get(symbol);
    if (cachedData?.timeSeriesData?.length) {
      logApi(`Using cached data for ${symbol}`);
      return {
        timeSeriesData: cachedData.timeSeriesData,
        significantMoves: cachedData.significantMoves || []
      };
    }
  }
  return null;
}

/**
 * Save data to cache
 */
function saveToCache(symbol: string, data: any): void {
  if (currentConfig.cacheResults && data) {
    logApi(`Saving ${symbol} data to cache`);
    companyDataCache.set(symbol, data);
  }
}

// ===== OHLC Data API =====

// Add API key status tracking
interface ApiKeyStatus {
  key: string;
  provider: string;
  lastUsed: number;
  errorCount: number;
  rateLimitedUntil: number;
}

// Track API key status
const apiKeyStatus: { [key: string]: ApiKeyStatus } = {};

/**
 * Check if an API key is currently rate limited
 */
function isKeyRateLimited(key: string): boolean {
  const status = apiKeyStatus[key];
  if (!status) return false;
  
  // Check if we're still within the rate limit period
  if (status.rateLimitedUntil > Date.now()) {
    logApi(`API key ${key.slice(0, 8)}... is rate limited until ${new Date(status.rateLimitedUntil).toISOString()}`, 'warn');
    return true;
  }
  
  return false;
}

/**
 * Mark an API key as rate limited
 */
function markKeyRateLimited(key: string, provider: string, durationMs: number = 60000) {
  if (!apiKeyStatus[key]) {
    apiKeyStatus[key] = {
      key,
      provider,
      lastUsed: Date.now(),
      errorCount: 0,
      rateLimitedUntil: 0
    };
  }
  
  apiKeyStatus[key].errorCount++;
  apiKeyStatus[key].rateLimitedUntil = Date.now() + durationMs;
  
  logApi(`Marked API key ${key.slice(0, 8)}... as rate limited for ${durationMs/1000}s`, 'warn', {
    provider,
    errorCount: apiKeyStatus[key].errorCount
  });
}

/**
 * Update API key status after successful use
 */
function markKeySuccess(key: string, provider: string) {
  if (!apiKeyStatus[key]) {
    apiKeyStatus[key] = {
      key,
      provider,
      lastUsed: Date.now(),
      errorCount: 0,
      rateLimitedUntil: 0
    };
  }
  
  // Reset error count on success
  apiKeyStatus[key].errorCount = 0;
  apiKeyStatus[key].lastUsed = Date.now();
  apiKeyStatus[key].rateLimitedUntil = 0;
}

/**
 * Get the next available API key for a provider
 */
function getAvailableApiKey(provider: string): string | null {
  const config = provider === PROVIDERS.ALPHA_VANTAGE.name ? 
    currentConfig.alphaVantageConfig : 
    currentConfig.finnhubConfig;
  
  // If we have multiple API keys, try to find one that's not rate limited
  if (Array.isArray(config.apiKey)) {
    for (const key of config.apiKey) {
      if (!isKeyRateLimited(key)) {
        return key;
      }
    }
    return null; // All keys are rate limited
  }
  
  // Single API key
  return isKeyRateLimited(config.apiKey) ? null : config.apiKey;
}

/**
 * Enhanced getOHLCFromFinnhub with API key management
 */
async function getOHLCFromFinnhub(symbol: string, timeframe: string): Promise<StockDataResult> {
  const apiKey = getAvailableApiKey(PROVIDERS.FINNHUB.name);
  if (!apiKey) {
    throw new Error('All Finnhub API keys are currently rate limited');
  }
  
  try {
    // Make the API call with the selected key
    const result = await finnhubQueue.enqueue(async () => {
      logApi(`Fetching OHLC data for ${symbol} from Finnhub`);
      
      // Calculate date range based on timeframe
      const now = Math.floor(Date.now() / 1000);
      const oneDay = 24 * 60 * 60;
      let fromTime: number;
      let resolution: 'D' | '60' | '15' = 'D';
      
      switch (timeframe) {
        case '1w':
          fromTime = now - (7 * oneDay);
          resolution = '15';
          break;
        case '1m':
          fromTime = now - (30 * oneDay);
          resolution = '60';
          break;
        case '3m':
          fromTime = now - (90 * oneDay);
          resolution = 'D';
          break;
        case '6m':
          fromTime = now - (180 * oneDay);
          resolution = 'D';
          break;
        case '1y':
          fromTime = now - (365 * oneDay);
          resolution = 'D';
          break;
        default:
          fromTime = now - (90 * oneDay);
          resolution = 'D';
          break;
      }
      
      const candles = await getStockCandles(symbol, fromTime, now, 'D');
      
      if (candles.s !== 'ok' || !candles.t || candles.t.length === 0) {
        throw new Error(`Invalid Finnhub response for ${symbol}: ${candles.s || 'No status'}`);
      }
      
      // Convert Finnhub format to our standard OHLC format
      const timeSeriesData: OHLCData[] = candles.t.map((timestamp, index) => {
        const open = candles.o[index];
        const close = candles.c[index];
        const percentageChange = ((close - open) / open) * 100;
        
        return {
          date: new Date(timestamp * 1000).toISOString().split('T')[0],
          open,
          high: candles.h[index],
          low: candles.l[index],
          close,
          volume: candles.v[index],
          percentageChange: Number(percentageChange.toFixed(2)),
          direction: percentageChange >= 0 ? 'up' as const : 'down' as const
        };
      }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
      // Process the data to find significant moves
      const significantMoves = [];
      
      // Calculate average volume
      const avgVolume = timeSeriesData.reduce((sum, day) => sum + day.volume, 0) / timeSeriesData.length;
      
      // Find days with significant price and volume movement
      for (const day of timeSeriesData) {
        // Significant move criteria: >2% price change AND volume > 1.5x average
        if (Math.abs(day.percentageChange) > 2 && day.volume > avgVolume * 1.5) {
          significantMoves.push(day);
        }
      }
      
      // Sort by date (most recent first) and limit to top 10
      significantMoves.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      significantMoves.splice(10);
      
      return { timeSeriesData, significantMoves };
    });
    
    // Mark the key as successful
    markKeySuccess(apiKey, PROVIDERS.FINNHUB.name);
    
    return result;
  } catch (error) {
    if (isRateLimitError(error)) {
      markKeyRateLimited(apiKey, PROVIDERS.FINNHUB.name);
    }
    throw error;
  }
}

/**
 * Enhanced getOHLCFromAlphaVantage with API key management
 */
async function getOHLCFromAlphaVantage(symbol: string, timeframe: string): Promise<StockDataResult> {
  const apiKey = getAvailableApiKey(PROVIDERS.ALPHA_VANTAGE.name);
  if (!apiKey) {
    throw new Error('All Alpha Vantage API keys are currently rate limited');
  }
  
  try {
    // Make the API call with the selected key
    const result = await alphaVantageQueue.enqueue(async () => {
      logApi(`Fetching OHLC data for ${symbol} from Alpha Vantage with timeframe ${timeframe}`);
      
      // Convert timeframe to Alpha Vantage format
      const outputsize = timeframe === '1w' || timeframe === '1m' ? 'compact' : 'full';
      const result = await getDailyTimeSeries(symbol, outputsize);
      
      // Filter data based on timeframe
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;
      const timeframeMap = {
        '1w': 7 * oneDay,
        '1m': 30 * oneDay,
        '3m': 90 * oneDay,
        '6m': 180 * oneDay,
        '1y': 365 * oneDay
      };
      
      const timeframeMs = timeframeMap[timeframe] || timeframeMap['3m'];
      const cutoffDate = new Date(now - timeframeMs).toISOString().split('T')[0];
      
      const filteredData = result.allDailyData.filter(day => day.date >= cutoffDate);
      
      // Calculate significant moves
      const avgVolume = filteredData.reduce((sum, day) => sum + day.volume, 0) / filteredData.length;
      const significantMoves = [];
      
      // Find days with significant price and volume movement
      for (const day of filteredData) {
        // Significant move criteria: >2% price change AND volume > 1.5x average
        if (Math.abs(day.percentageChange) > 2 && day.volume > avgVolume * 1.5) {
          significantMoves.push(day);
        }
      }
      
      // Sort by date (most recent first) and limit to top 10
      significantMoves.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      significantMoves.splice(10);
      
      return {
        timeSeriesData: filteredData,
        significantMoves
      };
    });
    
    // Mark the key as successful
    markKeySuccess(apiKey, PROVIDERS.ALPHA_VANTAGE.name);
    
    return result;
  } catch (error) {
    if (isRateLimitError(error)) {
      markKeyRateLimited(apiKey, PROVIDERS.ALPHA_VANTAGE.name);
    }
    throw error;
  }
}

/**
 * Unified API to get OHLC data with fallback
 */
export async function getStockData(
  symbol: string, 
  timeframe: string = '3m',
  forceRefresh: boolean = false
): Promise<StockDataResult> {
  logApi(`Starting getStockData for ${symbol}`, 'info', { timeframe, forceRefresh });
  
  // Check if we're rate limited and have cached data
  if (isRateLimited && !forceRefresh) {
    logApi(`Rate limited check for ${symbol}`, 'warn', { isRateLimited });
    const cachedData = checkCache(symbol);
    if (cachedData) {
      logApi(`Using cached data for ${symbol} due to rate limiting`, 'warn', {
        cacheAge: Date.now() - (cachedData.timestamp || 0),
        dataPoints: cachedData.timeSeriesData?.length
      });
      return cachedData;
    }
  }

  // Standardize symbol and timeframe
  symbol = symbol.toUpperCase();
  const standardizedTimeframe = (() => {
    switch (timeframe) {
      case '1w': return '1w';
      case '1mo': return '1m';
      case '3mo': return '3m';
      case '6mo': return '6m';
      case '1y': return '1y';
      default: return '3m';
    }
  })();
  
  logApi(`Standardized symbol: ${symbol}, timeframe: ${standardizedTimeframe}`, 'info');

  // Check cache first if not forcing refresh
  if (!forceRefresh) {
    const cachedData = checkCache(symbol);
    if (cachedData) {
      const cacheAge = Date.now() - (cachedData.timestamp || 0);
      const isMarketHours = new Date().getHours() >= 9 && new Date().getHours() < 16;
      const maxCacheAge = isMarketHours ? 60 * 60 * 1000 : 6 * 60 * 60 * 1000;
      
      logApi(`Cache check for ${symbol}`, 'info', {
        cacheAge,
        maxCacheAge,
        isMarketHours,
        dataPoints: cachedData.timeSeriesData?.length
      });
      
      if (cacheAge < maxCacheAge) {
        logApi(`Using fresh cached data for ${symbol}`, 'info');
        return cachedData;
      }
    }
  } else {
    logApi(`Forced refresh requested for ${symbol}`, 'info');
  }

  // Determine order of providers based on configuration
  const providers = [
    currentConfig.preferredOHLCProvider,
    ...(currentConfig.enableFallback 
      ? [currentConfig.preferredOHLCProvider.name === PROVIDERS.ALPHA_VANTAGE.name 
          ? PROVIDERS.FINNHUB 
          : PROVIDERS.ALPHA_VANTAGE] 
      : [])
  ];
  
  logApi(`Provider order for ${symbol}`, 'info', { 
    providers: providers.map(p => p.name),
    enableFallback: currentConfig.enableFallback
  });
  
  // Try each provider in sequence
  let lastError: any = null;
  
  for (const provider of providers) {
    try {
      logApi(`Attempting to fetch data from ${provider.name}`, 'info');
      
      let result: StockDataResult;
      
      // Use retry helper for better error handling
      if (provider.name === PROVIDERS.ALPHA_VANTAGE.name) {
        result = await retryWhenRateLimited(
          () => getOHLCFromAlphaVantage(symbol, standardizedTimeframe),
          {
            maxRetries: 2,
            onRetry: (attempt: number, delay: number) => {
              logApi(`Retrying Alpha Vantage for ${symbol}`, 'warn', { attempt, delay });
            }
          }
        );
      } else {
        result = await retryWhenRateLimited(
          () => getOHLCFromFinnhub(symbol, standardizedTimeframe),
          {
            maxRetries: 2,
            onRetry: (attempt: number, delay: number) => {
              logApi(`Retrying Finnhub for ${symbol}`, 'warn', { attempt, delay });
            }
          }
        );
      }
      
      // Log successful response
      logApi(`Successfully fetched data from ${provider.name}`, 'info', {
        dataPoints: result.timeSeriesData?.length,
        firstDate: result.timeSeriesData?.[0]?.date,
        lastDate: result.timeSeriesData?.[result.timeSeriesData.length - 1]?.date
      });
      
      // Add timestamp and forceRefresh flag to result
      const timestampedResult = {
        ...result,
        timestamp: Date.now(),
        forceRefreshed: forceRefresh,
        provider: provider.name
      };
      
      // Save to cache if allowed
      if (currentConfig.cacheResults && !forceRefresh) {
        logApi(`Caching results from ${provider.name}`, 'info');
        saveToCache(symbol, timestampedResult);
      }
      
      return timestampedResult;
    } catch (error) {
      lastError = error;
      logApi(`Provider ${provider.name} failed`, 'error', { error });
      
      // Check for rate limiting
      if (typeof error === 'object' && error !== null) {
        const errorStr = error.toString().toLowerCase();
        if (
          errorStr.includes('rate limit') || 
          errorStr.includes('too many requests') ||
          errorStr.includes('429')
        ) {
          logApi(`Rate limit detected for ${provider.name}`, 'warn');
          setRateLimited(true);
        }
      }
      
      if (!currentConfig.enableFallback) {
        logApi(`Fallback disabled, stopping after ${provider.name} failure`, 'warn');
        break;
      }
    }
  }
  
  // All providers failed
  logApi('All providers failed', 'error', { lastError });
  
  // Final attempt to get from cache if not forcing refresh
  if (!forceRefresh) {
    const finalCacheCheck = checkCache(symbol);
    if (finalCacheCheck) {
      logApi(`Using cached data as final fallback for ${symbol}`, 'warn', {
        cacheAge: Date.now() - (finalCacheCheck.timestamp || 0),
        dataPoints: finalCacheCheck.timeSeriesData?.length
      });
      return finalCacheCheck;
    }
  }
  
  // If everything failed, throw the last error
  throw lastError || new Error(`Failed to fetch stock data for ${symbol}`);
}

// ===== News API =====

/**
 * Get news from Finnhub
 */
async function getNewsFromFinnhub(symbol: string, days: number = 30): Promise<NewsItem[]> {
  logApi(`Fetching news for ${symbol} from Finnhub`);
  
  return finnhubQueue.enqueue(async () => {
    try {
      // Calculate date range
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      const from = formatDateYYYYMMDD(startDate);
      const to = formatDateYYYYMMDD(endDate);
      
      const news = await getCompanyNews(symbol, from, to);
      
      if (!news || !Array.isArray(news)) {
        throw new Error(`Invalid Finnhub news response for ${symbol}`);
      }
      
      // Format the news items
      return news
        .filter(item => (
          item.category === 'company news' || 
          item.related?.includes(symbol) ||
          item.headline?.includes(symbol)
        ))
        .map(item => ({
          date: formatDateYYYYMMDD(new Date(item.datetime * 1000)),
          title: item.headline,
          source: item.source,
          url: item.url,
          summary: item.summary
        }))
        .slice(0, 10); // Limit to 10 items
    } catch (error) {
      logApi(`Error fetching news from Finnhub: ${error}`);
      throw error;
    }
  });
}

/**
 * Get news from Alpha Vantage
 * Alpha Vantage has a News Sentiment API we can use as fallback
 */
async function getNewsFromAlphaVantage(symbol: string): Promise<NewsItem[]> {
  logApi(`Fetching news for ${symbol} from Alpha Vantage`);
  
  return alphaVantageQueue.enqueue(async () => {
    try {
      const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${symbol}&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.Information?.includes('API rate limit')) {
        setRateLimited(true);
        throw new Error('Alpha Vantage API rate limit exceeded');
      }
      
      if (!data.feed || !Array.isArray(data.feed)) {
        throw new Error(`Invalid Alpha Vantage news response for ${symbol}`);
      }
      
      // Format the news items
      return data.feed
        .slice(0, 10) // Limit to 10 items
        .map((item: any) => {
          const time = item.time_published; // Format: YYYYMMDDTHHMMSS
          const year = time.substring(0, 4);
          const month = time.substring(4, 6);
          const day = time.substring(6, 8);
          
          return {
            date: `${year}-${month}-${day}`,
            title: item.title,
            source: item.source,
            url: item.url,
            summary: item.summary
          };
        });
    } catch (error) {
      logApi(`Error fetching news from Alpha Vantage: ${error}`);
      throw error;
    }
  });
}

/**
 * Unified API to get news with fallback
 */
export async function getCompanyNewsWithFallback(symbol: string, days: number = 30): Promise<NewsItem[]> {
  // Standardize symbol
  symbol = symbol.toUpperCase();
  logApi(`Getting news for ${symbol}`);

  // Determine order of providers based on configuration
  const providers = [
    currentConfig.preferredNewsProvider,
    ...(currentConfig.enableFallback 
      ? [currentConfig.preferredNewsProvider.name === PROVIDERS.FINNHUB.name 
          ? PROVIDERS.ALPHA_VANTAGE 
          : PROVIDERS.FINNHUB] 
      : [])
  ];

  // Try each provider in sequence
  let lastError: any = null;
  
  for (const provider of providers) {
    try {
      let news: NewsItem[];
      
      if (provider.name === PROVIDERS.FINNHUB.name) {
        news = await getNewsFromFinnhub(symbol, days);
      } else {
        news = await getNewsFromAlphaVantage(symbol);
      }
      
      // If we got here, the request succeeded
      logApi(`Successfully fetched news from ${provider.name}`);
      
      return news;
    } catch (error) {
      lastError = error;
      logApi(`Provider ${provider.name} failed, ${currentConfig.enableFallback ? 'trying next provider' : 'aborting'}`);
      
      // If fallback is disabled, break immediately
      if (!currentConfig.enableFallback) break;
    }
  }
  
  // All providers failed
  logApi('All providers failed, returning empty news array');
  
  // For news, it's better to return an empty array than throw an error
  return [];
}

// ===== Company Profile API =====

/**
 * Get company profile from Finnhub
 */
async function getCompanyProfileFromFinnhub(symbol: string): Promise<CompanyProfile> {
  logApi(`Fetching company profile for ${symbol} from Finnhub`);
  
  return finnhubQueue.enqueue(async () => {
    try {
      // Import directly here to avoid circular dependencies
      const { getCompanyProfile } = await import('./finnhub');
      const profile = await getCompanyProfile(symbol);
      
      if (!profile || !profile.name) {
        throw new Error(`Invalid company profile response from Finnhub for ${symbol}`);
      }
      
      return {
        name: profile.name,
        description: profile.description || '',
        marketCap: profile.marketCapitalization ? profile.marketCapitalization * 1000000 : 0, // Convert from millions
        volume: profile.shareOutstanding || 0,
        sector: profile.sector || 'Unknown',
        industry: profile.industry || 'Unknown'
      };
    } catch (error) {
      logApi(`Error fetching company profile from Finnhub: ${error}`);
      throw error;
    }
  });
}

/**
 * Get company profile from Alpha Vantage
 * Alpha Vantage has a Company Overview API we can use as fallback
 */
async function getCompanyProfileFromAlphaVantage(symbol: string): Promise<CompanyProfile> {
  logApi(`Fetching company profile for ${symbol} from Alpha Vantage`);
  
  return alphaVantageQueue.enqueue(async () => {
    try {
      const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${symbol}&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.Information?.includes('API rate limit')) {
        setRateLimited(true);
        throw new Error('Alpha Vantage API rate limit exceeded');
      }
      
      if (!data.Name || !data.Symbol) {
        throw new Error(`Invalid Alpha Vantage company profile response for ${symbol}`);
      }
      
      return {
        name: data.Name,
        description: data.Description || '',
        marketCap: parseFloat(data.MarketCapitalization) || 0,
        volume: parseFloat(data.SharesOutstanding) || 0,
        sector: data.Sector || 'Unknown',
        industry: data.Industry || 'Unknown'
      };
    } catch (error) {
      logApi(`Error fetching company profile from Alpha Vantage: ${error}`);
      throw error;
    }
  });
}

/**
 * Unified API to get company profile with fallback
 */
export async function getCompanyProfileWithFallback(symbol: string): Promise<CompanyProfile> {
  // Standardize symbol
  symbol = symbol.toUpperCase();
  logApi(`Getting company profile for ${symbol}`);
  
  // Check if we're rate limited and have cached data
  if (isRateLimited) {
    logApi('API is rate limited, checking cache', 'warn');
    const cachedData = companyDataCache.get(symbol);
    if (cachedData?.companyInfo) {
      logApi(`Using cached company profile for ${symbol} due to rate limiting`);
      return cachedData.companyInfo;
    }
  }
  
  // Check cache first regardless of rate limiting
  const cachedData = companyDataCache.get(symbol);
  if (cachedData?.companyInfo) {
    const cacheAge = Date.now() - (cachedData.lastUpdated || 0);
    const cacheAgeMinutes = Math.round(cacheAge / 60000);
    logApi(`Found cached company profile for ${symbol} (${cacheAgeMinutes} minutes old)`);
    
    // If cache is fresh (less than 30 minutes), use it
    if (cacheAge < 1800000) {
      logApi(`Using fresh cached company profile for ${symbol}`);
      return cachedData.companyInfo;
    } else {
      logApi(`Cached company profile for ${symbol} is stale, will try to refresh`);
    }
  }

  // Determine order of providers based on configuration
  const providers = [
    { name: 'Finnhub', priority: 1 }, // Default to Finnhub for company info
    ...(currentConfig.enableFallback ? [{ name: 'AlphaVantage', priority: 2 }] : [])
  ];

  // Try each provider in sequence
  let lastError: any = null;
  
  for (const provider of providers) {
    try {
      logApi(`Attempting to fetch company profile for ${symbol} from ${provider.name}`);
      
      let profile: CompanyProfile;
      
      if (provider.name === 'Finnhub') {
        profile = await getCompanyProfileFromFinnhub(symbol);
      } else {
        profile = await getCompanyProfileFromAlphaVantage(symbol);
      }
      
      // If we got here, the request succeeded
      logApi(`Successfully fetched company profile from ${provider.name}`);
      
      // Save to cache
      if (currentConfig.cacheResults) {
        logApi(`Caching company profile for ${symbol}`);
        companyDataCache.set(symbol, { 
          name: profile.name,
          companyInfo: profile,
          lastUpdated: Date.now()
        });
      }
      
      // Reset rate limited flag if we succeeded
      setRateLimited(false);
      
      return profile;
    } catch (error) {
      lastError = error;
      const errorMessage = error instanceof Error ? error.message : String(error);
      logApi(`Provider ${provider.name} failed for ${symbol}: ${errorMessage}`, 'error');
      
      // Check if it's a rate limit error
      if (errorMessage.toLowerCase().includes('rate limit') || 
          errorMessage.toLowerCase().includes('too many requests')) {
        logApi(`Rate limit detected for ${provider.name}`, 'warn');
        // Only set rate limited if we don't have more providers to try
        if (!currentConfig.enableFallback || provider.name === 'AlphaVantage') {
          setRateLimited(true, 3600000); // 1 hour
        }
      }
      
      // If fallback is disabled, break immediately
      if (!currentConfig.enableFallback) {
        logApi('Fallback is disabled, aborting after first failure', 'warn');
        break;
      } else {
        logApi(`Will try next provider for ${symbol}`);
      }
    }
  }
  
  // All providers failed
  logApi('All providers failed, checking cache one last time', 'warn');
  
  // Final attempt to get from cache, even if it's stale
  const finalCacheCheck = companyDataCache.get(symbol);
  if (finalCacheCheck?.companyInfo) {
    logApi(`Using cached company profile for ${symbol} as last resort`, 'warn');
    return finalCacheCheck.companyInfo;
  }
  
  // If everything failed, throw the last error
  logApi(`Failed to fetch company profile for ${symbol} from any source`, 'error');
  throw lastError || new Error(`Failed to fetch company profile for ${symbol}`);
}