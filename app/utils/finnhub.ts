const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const BASE_URL = 'https://finnhub.io/api/v1';
import { companyDataCache, setRateLimited } from './cache';

if (!FINNHUB_API_KEY) {
  console.error('FINNHUB_API_KEY is not set in environment variables');
}

interface StockCandle {
  c: number[]; // Close prices
  h: number[]; // High prices
  l: number[]; // Low prices
  o: number[]; // Open prices
  s: string;   // Status
  t: number[]; // Timestamps
  v: number[]; // Volume data
  error?: string; // Error message from API
}

interface CompanyProfile {
  name: string;
  description: string;
  marketCapitalization: number;
  shareOutstanding: number;
  industry: string;
  sector: string;
  // ... other fields
}

interface NewsItem {
  category: string;
  datetime: number;
  headline: string;
  id: number;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

async function makeRequest(url: string) {
  console.log('Making Finnhub API request:', url);
  try {
    const response = await fetch(url);
    
    // Check for rate limiting by status code
    if (response.status === 429) {
      console.error('Finnhub API rate limit reached');
      setRateLimited(true);
      throw new Error('Rate limit reached');
    }
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Reset rate limited flag when we successfully get data
    setRateLimited(false);
    
    console.log('Finnhub API response:', data);
    return data;
  } catch (error: any) {
    console.error('Error making Finnhub API request:', error);
    if (error.message === 'Rate limit reached') {
      throw error; // Re-throw to handle it in the calling function
    }
    // For other errors, let's assume API might be having issues
    setRateLimited(true);
    throw error;
  }
}

export async function getStockCandles(symbol: string, from: number, to: number, resolution = 'D'): Promise<StockCandle> {
  const url = `${BASE_URL}/stock/candle?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${to}&token=${FINNHUB_API_KEY}`;
  return makeRequest(url);
}

export async function getCompanyProfile(symbol: string): Promise<CompanyProfile> {
  try {
    // Try to get from cache first if rate limited
    const cachedData = companyDataCache.get(symbol);
    if (cachedData?.companyInfo) {
      console.log(`Using cached company info for ${symbol}`);
      return cachedData.companyInfo;
    }
    
    const url = `${BASE_URL}/stock/profile2?symbol=${symbol}&token=${FINNHUB_API_KEY}`;
    const data = await makeRequest(url);
    
    // Cache the company info
    if (data && data.name) {
      companyDataCache.set(symbol, {
        name: data.name,
        companyInfo: data
      });
    }
    
    return data;
  } catch (error) {
    console.error(`Error getting company profile for ${symbol}:`, error);
    
    // If we have cached data, use it
    const cachedData = companyDataCache.get(symbol);
    if (cachedData?.companyInfo) {
      console.log(`Using cached company info for ${symbol}`);
      return cachedData.companyInfo;
    }
    
    // Otherwise throw the error
    throw error;
  }
}

export async function getCompanyNews(symbol: string, from: string, to: string): Promise<NewsItem[]> {
  try {
    const url = `${BASE_URL}/company-news?symbol=${symbol}&from=${from}&to=${to}&token=${FINNHUB_API_KEY}`;
    return makeRequest(url);
  } catch (error) {
    console.error(`Error getting company news for ${symbol}:`, error);
    
    // Return empty array on error rather than throwing
    return [];
  }
}

export async function searchSymbol(query: string): Promise<Array<{ symbol: string; description: string }>> {
  const url = `${BASE_URL}/search?q=${query}&token=${FINNHUB_API_KEY}`;
  const data = await makeRequest(url);
  return data.result || [];
}

export function getTimeframeTimestamps(timeframe: string): { from: number; to: number } {
  const now = new Date();
  const to = Math.floor(now.getTime() / 1000);
  let from: number;

  switch (timeframe) {
    case '1w':
      from = to - 7 * 24 * 60 * 60;
      break;
    case '1m':
      from = to - 30 * 24 * 60 * 60;
      break;
    case '3m':
      from = to - 90 * 24 * 60 * 60;
      break;
    case '1y':
      from = to - 365 * 24 * 60 * 60;
      break;
    case '5y':
      from = to - 5 * 365 * 24 * 60 * 60;
      break;
    default:
      from = to - 30 * 24 * 60 * 60;
  }

  return { from, to };
}

export function formatDateYYYYMMDD(date: Date): string {
  return date.toISOString().split('T')[0];
}

export interface TradeData {
  p: number;    // Last price
  s: string;    // Symbol
  t: number;    // UNIX milliseconds timestamp
  v: number;    // Volume
}

export interface WebSocketMessage {
  type: string;
  data: TradeData[];
}

let ws: WebSocket | null = null;
let subscribers: Map<string, Set<(data: TradeData) => void>> = new Map();
let pendingSubscriptions: Set<string> = new Set();
let isConnecting = false;

export function connectWebSocket(): Promise<WebSocket> {
  if (ws?.readyState === WebSocket.OPEN) {
    return Promise.resolve(ws);
  }

  if (isConnecting) {
    return new Promise((resolve) => {
      const checkConnection = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          clearInterval(checkConnection);
          resolve(ws);
        }
      }, 100);
    });
  }

  isConnecting = true;
  return new Promise((resolve, reject) => {
    ws = new WebSocket(`wss://ws.finnhub.io?token=${FINNHUB_API_KEY}`);

    ws.onopen = () => {
      console.log('Finnhub WebSocket connected');
      isConnecting = false;
      // Subscribe to any pending symbols
      pendingSubscriptions.forEach(symbol => {
        ws?.send(JSON.stringify({ type: 'subscribe', symbol }));
      });
      pendingSubscriptions.clear();
      resolve(ws!);
    };

    ws.onmessage = (event) => {
      const message: WebSocketMessage = JSON.parse(event.data);
      if (message.type === 'trade') {
        message.data.forEach(trade => {
          const symbol = trade.s;
          const callbacks = subscribers.get(symbol);
          if (callbacks) {
            callbacks.forEach(callback => callback(trade));
          }
        });
      }
    };

    ws.onerror = (error) => {
      console.error('Finnhub WebSocket error:', error);
      isConnecting = false;
      reject(error);
    };

    ws.onclose = () => {
      console.log('Finnhub WebSocket connection closed');
      isConnecting = false;
      ws = null;
      // Keep track of current subscriptions for reconnection
      subscribers.forEach((_, symbol) => {
        pendingSubscriptions.add(symbol);
      });
    };
  });
}

export async function subscribeToSymbol(symbol: string, callback: (data: TradeData) => void) {
  try {
    const socket = await connectWebSocket();
    
    if (!subscribers.has(symbol)) {
      subscribers.set(symbol, new Set());
      socket.send(JSON.stringify({ type: 'subscribe', symbol }));
    }
    
    subscribers.get(symbol)?.add(callback);
  } catch (error) {
    console.error(`Error subscribing to ${symbol}:`, error);
  }
}

export async function unsubscribeFromSymbol(symbol: string, callback?: (data: TradeData) => void) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  try {
    if (callback) {
      subscribers.get(symbol)?.delete(callback);
      if (subscribers.get(symbol)?.size === 0) {
        ws.send(JSON.stringify({ type: 'unsubscribe', symbol }));
        subscribers.delete(symbol);
        pendingSubscriptions.delete(symbol);
      }
    } else {
      ws.send(JSON.stringify({ type: 'unsubscribe', symbol }));
      subscribers.delete(symbol);
      pendingSubscriptions.delete(symbol);
    }
  } catch (error) {
    console.error(`Error unsubscribing from ${symbol}:`, error);
  }
}

export function closeWebSocket() {
  if (ws) {
    subscribers.clear();
    pendingSubscriptions.clear();
    ws.close();
    ws = null;
  }
} 