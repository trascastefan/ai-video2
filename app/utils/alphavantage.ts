const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY;
const BASE_URL = 'https://www.alphavantage.co/query';

import { companyDataCache, setRateLimited } from './cache';

if (!ALPHA_VANTAGE_API_KEY) {
  console.error('ALPHA_VANTAGE_API_KEY is not set in environment variables');
}

// Generate 90 days of mock data with more significant price movements
const MOCK_DATA: DailyData[] = Array.from({ length: 90 }, (_, i) => {
  const date = new Date();
  date.setDate(date.getDate() - i);
  
  // Base values with more dramatic variations
  const basePrice = 182.50;
  const volatility = 5.0; // Increased volatility
  
  // Generate more dramatic price movements
  const randomChange = (Math.random() - 0.5) * volatility * 2; // Double the potential change
  const open = basePrice + randomChange;
  const high = open + Math.random() * volatility * 1.5;
  const low = open - Math.random() * volatility * 1.5;
  const close = (open + high + low) / 3 + (Math.random() - 0.5) * volatility;
  
  // Generate volume with occasional spikes
  const baseVolume = 45000000;
  const volumeSpike = Math.random() < 0.2 ? 3 : 1; // 20% chance of volume spike
  const volume = Math.floor(baseVolume + (Math.random() * 15000000 * volumeSpike));
  
  const percentageChange = ((close - open) / open) * 100;
  
  return {
    date: date.toISOString().split('T')[0],
    open: Number(open.toFixed(2)),
    high: Number(high.toFixed(2)),
    low: Number(low.toFixed(2)),
    close: Number(close.toFixed(2)),
    volume: volume,
    percentageChange: Number(percentageChange.toFixed(2)),
    direction: percentageChange >= 0 ? 'up' : 'down'
  };
});

interface AlphaVantageQuote {
  'Global Quote': {
    '01. symbol': string;
    '02. open': string;
    '03. high': string;
    '04. low': string;
    '05. price': string;
    '06. volume': string;
    '07. latest trading day': string;
    '08. previous close': string;
    '09. change': string;
    '10. change percent': string;
  };
  Information?: string; // For error responses
}

interface AlphaVantageDailyTimeSeries {
  'Meta Data': {
    '1. Information': string;
    '2. Symbol': string;
    '3. Last Refreshed': string;
    '4. Output Size': string;
    '5. Time Zone': string;
  };
  'Time Series (Daily)': {
    [date: string]: {
      '1. open': string;
      '2. high': string;
      '3. low': string;
      '4. close': string;
      '5. volume': string;
    };
  };
  Information?: string; // For error responses
}

export interface DailyData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  percentageChange: number;
  direction: 'up' | 'down';
  impactScore?: number; // Added impact score
}

export interface ProcessedVolumeData {
  allDailyData: DailyData[];
  significantPriceMoves: DailyData[];
}

async function makeRequest(url: string) {
  console.log('Making Alpha Vantage API request:', url.replace(process.env.ALPHA_VANTAGE_API_KEY || '', '[API_KEY]'));
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error('Alpha Vantage API error:', response.status, response.statusText);
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    console.log('Alpha Vantage API response structure:', Object.keys(data));
    return data;
  } catch (error) {
    console.error('Error in Alpha Vantage makeRequest:', error);
    throw error;
  }
}

export async function getDailyTimeSeries(symbol: string, timeframe: string = '3m'): Promise<ProcessedVolumeData> {
  try {
    console.log(`Getting daily data for ${symbol} with timeframe ${timeframe}`);
    
    // Check if we have cached data for this symbol/timeframe
    const cachedData = companyDataCache.get(symbol);
    
    // Use TIME_SERIES_DAILY API endpoint to get historical data
    const outputSize = timeframe === '1y' || timeframe === '5y' ? 'full' : 'compact';
    const url = `${BASE_URL}?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=${outputSize}&apikey=${ALPHA_VANTAGE_API_KEY}`;
    
    try {
      const data: AlphaVantageDailyTimeSeries = await makeRequest(url);

      // Check for rate limiting
      if (data.Information?.includes('API rate limit')) {
        console.log('API rate limited, using cached data if available');
        setRateLimited(true);
        
        // If we have cached data, use it
        if (cachedData?.timeSeriesData?.length) {
          console.log(`Using cached data for ${symbol}`);
          return {
            allDailyData: cachedData.timeSeriesData,
            significantPriceMoves: cachedData.significantMoves
          };
        }
        
        // Otherwise fall back to mock data
        console.log('No cached data available, using mock data');
        return processVolumeData(MOCK_DATA);
      }

      // Reset rate limited flag when we successfully get data
      setRateLimited(false);

      if (!data['Time Series (Daily)']) {
        console.error('Invalid Alpha Vantage response structure:', data);
        
        // Check for cached data before falling back to mock
        if (cachedData?.timeSeriesData?.length) {
          console.log(`Using cached data for ${symbol}`);
          return {
            allDailyData: cachedData.timeSeriesData,
            significantPriceMoves: cachedData.significantMoves
          };
        }
        
        console.log('Falling back to mock data');
        return processVolumeData(MOCK_DATA);
      }

      const timeSeriesData = data['Time Series (Daily)'];
      const daysToInclude = getTimeframeDays(timeframe);
      
      // Process historical data
      const processedData: DailyData[] = Object.entries(timeSeriesData)
        .map(([date, values]) => {
          const open = parseFloat(values['1. open']);
          const close = parseFloat(values['4. close']);
          const percentageChange = ((close - open) / open) * 100;
          
          return {
            date,
            open,
            high: parseFloat(values['2. high']),
            low: parseFloat(values['3. low']),
            close,
            volume: parseInt(values['5. volume'], 10),
            percentageChange: Number(percentageChange.toFixed(2)),
            direction: percentageChange >= 0 ? 'up' as const : 'down' as const
          };
        })
        // Sort by date descending (most recent first)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        // Limit to the number of days needed for the timeframe
        .slice(0, daysToInclude);
      
      console.log(`Successfully processed ${processedData.length} days of time series data`);
      
      // Process the data
      const result = processVolumeData(processedData);
      
      // Cache the successful result
      companyDataCache.set(symbol, {
        timeSeriesData: result.allDailyData,
        significantMoves: result.significantPriceMoves
      });
      
      return result;
    } catch (error) {
      console.error('Error fetching from Alpha Vantage:', error);
      
      // Set rate limited flag as this might be a rate limit error
      setRateLimited(true);
      
      // Check for cached data before falling back to mock
      if (cachedData?.timeSeriesData?.length) {
        console.log(`Using cached data for ${symbol}`);
        return {
          allDailyData: cachedData.timeSeriesData,
          significantPriceMoves: cachedData.significantMoves
        };
      }
      
      return processVolumeData(MOCK_DATA);
    }
  } catch (error) {
    console.error('Error in getDailyTimeSeries:', error);
    
    // Check for cached data before falling back to mock
    const cachedData = companyDataCache.get(symbol);
    if (cachedData?.timeSeriesData?.length) {
      console.log(`Using cached data for ${symbol}`);
      return {
        allDailyData: cachedData.timeSeriesData,
        significantPriceMoves: cachedData.significantMoves
      };
    }
    
    return processVolumeData(MOCK_DATA);
  }
}

function calculateImpactScore(data: DailyData[]): DailyData[] {
  // Find max values for normalization
  const maxVolume = Math.max(...data.map(day => day.volume));
  const maxAbsPercentChange = Math.max(...data.map(day => Math.abs(day.percentageChange)));

  return data.map(day => ({
    ...day,
    impactScore: (
      // Normalize and weight percentage change (weight: 3)
      (3 * Math.abs(day.percentageChange) / maxAbsPercentChange) +
      // Normalize and weight volume (weight: 2)
      (2 * day.volume / maxVolume)
    )
  }));
}

function processVolumeData(data: DailyData[]): ProcessedVolumeData {
  // Sort by date descending to ensure consistent order
  const allDailyData = [...data].sort((a, b) => 
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  // Calculate impact scores for all days
  const daysWithImpactScores = calculateImpactScore(allDailyData);

  // Get top 5 days by impact score
  const significantPriceMoves = daysWithImpactScores
    .sort((a, b) => (b.impactScore || 0) - (a.impactScore || 0))
    .slice(0, 5);

  return {
    allDailyData: daysWithImpactScores,
    significantPriceMoves
  };
}

function getTimeframeDays(timeframe: string): number {
  switch (timeframe) {
    case '1w': return 7;
    case '1m': return 30;
    case '3m': return 90;
    case '1y': return 365;
    case '5y': return 1825;
    default: return 90; // Default to 3 months
  }
} 