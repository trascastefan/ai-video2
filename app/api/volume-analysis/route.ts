import { NextResponse } from 'next/server';
import { getCompanyProfile, formatDateYYYYMMDD } from '../../utils/finnhub';
import { companyDataCache, isRateLimited } from '../../utils/cache';
import { getStockData, getCompanyNewsWithFallback, getCompanyProfileWithFallback, NewsItem as StockNewsItem } from '../../utils/stock-api';

interface NewsItem {
  date: string;
  title: string;
  source: string;
  url: string;
  summary?: string;
}

interface SignificantMove {
  date: string;
  volume: number;
  price: number;
  priceChange: number;
  percentageChange: number;
  previousClose: number;
  high: number;
  low: number;
  news: NewsItem[];
}

interface VolumeAnalysisResponse {
  company: any;
  timeSeriesData: any[];
  significantMoves: SignificantMove[];
}

// Helper function to extract the base symbol without exchange prefix
function getBaseSymbol(symbol: string): string {
  return symbol.replace(/\..+$/, '').toUpperCase();
}

// Mock volume analysis for fallback
function mockVolumeAnalysis(symbol: string, timeframe: string) {
  return {
    symbol: symbol,
    companyName: symbol,
    timeSeriesData: Array(30).fill(0).map((_, i) => ({
      date: new Date(Date.now() - i * 86400000).toISOString().split('T')[0],
      open: 100 + Math.random() * 10,
      high: 105 + Math.random() * 10,
      low: 95 + Math.random() * 10,
      close: 100 + Math.random() * 10,
      volume: 1000000 + Math.random() * 2000000,
      percentageChange: (Math.random() * 4) - 2,
      direction: Math.random() > 0.5 ? 'up' : 'down'
    })),
    significantMoves: [],
    isMockData: true
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol')?.toUpperCase();
  // Convert timeframe to the format expected by the stock API
  const timeframeParam = searchParams.get('timeframe') || '3m';
  const timeframe = (() => {
    switch (timeframeParam) {
      case '1w': return '1w';
      case '1m': return '1mo';
      case '3m': return '3mo';
      case '6m': return '6mo';
      case '1y': return '1y';
      default: return '3mo';
    }
  })();
  const forceRefresh = searchParams.get('force') === 'true';
  const useMock = searchParams.get('mock') === 'true'; // Parameter to explicitly request mock data
  const disallowMock = searchParams.get('mock') === 'false'; // New parameter to disallow mock data

  if (!symbol) {
    return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });
  }
  
  console.log(`Processing volume analysis request for ${symbol} with timeframe ${timeframe}${forceRefresh ? ' (forced refresh)' : ''}${useMock ? ' (using mock data)' : ''}${disallowMock ? ' (disallowing mock data)' : ''}`);

  // Get the base symbol without any exchange prefix
  const baseSymbol = getBaseSymbol(symbol);
  
  try {
    // If mock data is explicitly requested, return it immediately
    if (useMock) {
      console.log(`Using mock data for ${symbol} volume analysis as explicitly requested`);
      return NextResponse.json(mockVolumeAnalysis(symbol, timeframe));
    }
    
    // Skip cache check if a forced refresh is requested
    if (!forceRefresh) {
      // Check for cached data
      const cachedData = companyDataCache.get(baseSymbol);
      
      if (cachedData?.timeSeriesData?.length) {
        const cacheAge = Date.now() - (cachedData.lastUpdated || 0);
        const maxAge = 3600000; // 1 hour
        
        if (cacheAge < maxAge) {
          console.log(`Using cached volume analysis for ${symbol} (age: ${Math.round(cacheAge/1000/60)} minutes)`);
          return NextResponse.json({
            symbol: baseSymbol,
            companyName: cachedData.name || baseSymbol,
            timeSeriesData: cachedData.timeSeriesData,
            significantMoves: cachedData.significantMoves || []
          });
        } else {
          console.log(`Cached volume analysis for ${symbol} is stale (${Math.round(cacheAge/1000/60)} minutes old)`);
        }
      }
    } else {
      console.log(`Forced refresh requested for ${symbol}, bypassing cache entirely`);
    }
    
    // Fetch new data
    const stockData = await getStockData(symbol, timeframe);
    
    if (!stockData.timeSeriesData || stockData.timeSeriesData.length === 0) {
      throw new Error('No time series data available');
    }
    
    // Process the data to find significant price moves
    const timeSeriesData = stockData.timeSeriesData;
    const significantMoves = [];
    
    // Find days with significant price and volume movement
    for (let i = 0; i < timeSeriesData.length; i++) {
      const day = timeSeriesData[i];
      
      // Significant move criteria: >2% price change AND volume > 1.5x 30-day average
      if (Math.abs(day.percentageChange) > 2) {
        // Calculate average volume for previous 30 days
        let volumeSum = 0;
        let count = 0;
        
        for (let j = i + 1; j < Math.min(i + 31, timeSeriesData.length); j++) {
          volumeSum += timeSeriesData[j].volume;
          count++;
        }
        
        const avgVolume = count > 0 ? volumeSum / count : day.volume;
        
        // Check if volume is significantly higher than average
        if (day.volume > avgVolume * 1.5) {
          // This is a significant move - get the previous close for reference
          const previousClose = i < timeSeriesData.length - 1 ? timeSeriesData[i + 1].close : day.open;
          
          // Format the date for news lookup
          const moveDate = new Date(day.date);
          const formattedDate = formatDateYYYYMMDD(moveDate);
          
          // Get news around this date
          const newsItems = await getCompanyNewsWithFallback(symbol, 3);
          
          // Filter news items around the move date (3 days before and after)
          const relevantNews = newsItems.filter(item => {
            const newsDate = new Date(item.date);
            const daysDiff = Math.abs((newsDate.getTime() - moveDate.getTime()) / (1000 * 60 * 60 * 24));
            return daysDiff <= 3;
          });
          
          // Add to significant moves
          significantMoves.push({
            date: day.date,
            volume: day.volume,
            price: day.close,
            priceChange: day.close - previousClose,
            percentageChange: day.percentageChange,
            previousClose: previousClose,
            high: day.high,
            low: day.low,
            news: relevantNews
          });
        }
      }
    }
    
    // Get company profile for additional info
    const companyProfile = await getCompanyProfileWithFallback(symbol);
    
    // Construct the response
    const response = {
      symbol: baseSymbol,
      companyName: companyProfile.name || baseSymbol,
      timeSeriesData: timeSeriesData.map(day => ({
        date: day.date,
        open: day.open,
        high: day.high,
        low: day.low,
        close: day.close,
        volume: day.volume,
        percentageChange: day.percentageChange,
        direction: day.percentageChange >= 0 ? 'up' : 'down'
      })),
      significantMoves: significantMoves,
      refreshedAt: new Date().toISOString()
    };
    
    // Cache the results if this isn't a forced refresh
    if (!forceRefresh) {
      companyDataCache.set(baseSymbol, {
        name: baseSymbol,
        symbol: baseSymbol,
        timeSeriesData: timeSeriesData,
        significantMoves: significantMoves,
        lastUpdated: Date.now()
      });
    }
    
    return NextResponse.json(response);
  } catch (error) {
    console.error(`Error in volume analysis API route for ${symbol}:`, error);
    
    // For forced refresh, we don't want to return either cached or mock data
    if (forceRefresh) {
      console.log(`Refresh failed for ${symbol}, returning error instead of fallback`);
      return NextResponse.json(
        { error: `Failed to refresh data: ${error instanceof Error ? error.message : 'Unknown error'}` },
        { status: 503 }
      );
    }
    
    // Try cache as fallback if not forcing refresh
    const cachedData = companyDataCache.get(baseSymbol);
    
    if (cachedData?.timeSeriesData?.length) {
      console.log(`Using cached volume analysis for ${symbol} as fallback after error`);
      return NextResponse.json({
        symbol: baseSymbol,
        companyName: cachedData.name || baseSymbol,
        timeSeriesData: cachedData.timeSeriesData,
        significantMoves: cachedData.significantMoves || [],
        fromCache: true,
        cacheTimestamp: cachedData.lastUpdated
      });
    }
    
    // Use mock data as last resort, but only if not explicitly disallowed
    if (!disallowMock) {
      console.log(`Using mock data for ${symbol} volume analysis as last resort`);
      return NextResponse.json(mockVolumeAnalysis(symbol, timeframe));
    }
    
    // If we get here, we couldn't provide any data
    return NextResponse.json(
      { error: `Failed to fetch volume analysis data: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
} 