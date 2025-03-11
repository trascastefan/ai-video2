'use client';

import React, { useState, useEffect, useRef } from 'react';
import StockSelector from './components/StockSelector';
import TimeframeSelector, { Timeframe } from './components/TimeframeSelector';
import CompanyInfo from './components/CompanyInfo';
import VolumeAnalysis, { TimeSeriesData, SignificantMove } from './components/VolumeAnalysis';
import StockChart from './components/StockChart';
import ChartWithControls from './components/ChartWithControls';
import { companyDataCache, isRateLimited, setRateLimited } from './utils/cache';
import { stockDB } from './utils/db'; // Import the IndexedDB database

interface CompanyData {
  name: string;
  description: string;
  marketCap: number;
  volume: number;
  sector: string;
  industry: string;
}

// Cache to store fetched data for different symbols and timeframes
interface CachedData {
  timeSeriesData: TimeSeriesData[];
  significantMoves: SignificantMove[];
  timestamp: number;
}

export default function Home() {
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [timeframe, setTimeframe] = useState<Timeframe>('1m');
  const [companyData, setCompanyData] = useState<CompanyData | undefined>(undefined);
  const [timeSeriesData, setTimeSeriesData] = useState<TimeSeriesData[]>([]);
  const [significantMoves, setSignificantMoves] = useState<SignificantMove[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isVolumeLoading, setIsVolumeLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedScript, setGeneratedScript] = useState('');
  const [rateLimited, setRateLimited] = useState(isRateLimited);
  const [recentStocks, setRecentStocks] = useState<string[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Cache for storing data for different symbols and timeframes
  const dataCache = useRef<Record<string, Record<string, CachedData>>>({});
  const defaultTimeframeRef = useRef<Timeframe>('3m'); // Default fetch is 3 months

  // Effect to check rate limit status
  useEffect(() => {
    setRateLimited(isRateLimited);
  }, []);
  
  // Effect to load recent stocks from IndexedDB
  useEffect(() => {
    const loadRecentStocks = async () => {
      try {
        const recent = await stockDB.getRecentStocks(10);
        setRecentStocks(recent);
      } catch (error) {
        console.error('Error loading recent stocks:', error);
      }
    };
    
    loadRecentStocks();
  }, []);

  // Handle symbol selection - fetch company data and 3-month data
  const handleSymbolSelect = (symbol: string) => {
    setSelectedSymbol(symbol);
    setTimeframe('1m'); // Reset to default timeframe when symbol changes
    
    // Store the company in companyDataCache if we select it
    if (symbol) {
      // If we don't have a name, use the symbol as name temporarily
      companyDataCache.set(symbol, { symbol, name: symbol });
    }
  };

  // Fetch company information
  useEffect(() => {
    const fetchCompanyData = async () => {
      if (!selectedSymbol) return;

      setIsLoading(true);
      
      // First try to get data from IndexedDB
      try {
        const dbCompanyProfile = await stockDB.getCompanyProfile(selectedSymbol);
        if (dbCompanyProfile) {
          console.log(`Using IndexedDB data for ${selectedSymbol} company profile`);
          setCompanyData(dbCompanyProfile);
          setIsLoading(false);
          return;
        }
      } catch (dbError) {
        console.error('Error accessing IndexedDB:', dbError);
      }
      
      // If not in IndexedDB, fetch from API
      try {
        const response = await fetch(`/api/company?symbol=${selectedSymbol}`);
        const data = await response.json();
        setCompanyData(data);
        
        // Store in our persistent cache
        companyDataCache.set(selectedSymbol, { 
          name: data.name,
          companyInfo: data
        });
        
        // Store in IndexedDB
        try {
          await stockDB.saveCompanyProfile({
            symbol: selectedSymbol,
            name: data.name,
            description: data.description,
            marketCap: data.marketCap,
            volume: data.volume,
            sector: data.sector,
            industry: data.industry,
            lastUpdated: Date.now()
          });
        } catch (dbError) {
          console.error('Error saving company profile to IndexedDB:', dbError);
        }
      } catch (error) {
        console.error('Error fetching company data:', error);
        setCompanyData(undefined);
        
        // Try to use cached data if available
        const cachedData = companyDataCache.get(selectedSymbol);
        if (cachedData?.companyInfo) {
          setCompanyData(cachedData.companyInfo);
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchCompanyData();
  }, [selectedSymbol]);

  // Fetch volume data based on symbol and timeframe selection
  useEffect(() => {
    const fetchVolumeData = async () => {
      if (!selectedSymbol) return;

      setIsVolumeLoading(true);
      
      // First check IndexedDB for data
      try {
        const dbStockData = await stockDB.getStockData(selectedSymbol);
        if (dbStockData) {
          // We have data in IndexedDB, filter based on timeframe
          const filteredData = getFilteredDataForTimeframe(
            dbStockData.timeSeriesData, 
            dbStockData.significantMoves,
            timeframe
          );
          
          // Update our in-memory cache
          if (!dataCache.current[selectedSymbol]) {
            dataCache.current[selectedSymbol] = {};
          }
          
          dataCache.current[selectedSymbol][timeframe] = {
            timeSeriesData: filteredData.timeSeriesData,
            significantMoves: filteredData.significantMoves,
            timestamp: dbStockData.lastUpdated
          };
          
          // Check if data is fresh enough (less than 24 hours old)
          const dataAge = Date.now() - dbStockData.lastUpdated;
          if (dataAge < 86400000) { // 24 hours in milliseconds
            console.log(`Using IndexedDB data for ${selectedSymbol}`);
            setTimeSeriesData(filteredData.timeSeriesData);
            setSignificantMoves(filteredData.significantMoves);
            setIsVolumeLoading(false);
            return;
          }
        }
      } catch (dbError) {
        console.error('Error accessing IndexedDB for stock data:', dbError);
      }

      try {
        // Check if we need to fetch new data
        const needsFetch = shouldFetchNewData(selectedSymbol, timeframe);
        
        if (needsFetch) {
          console.log(`Fetching new data for ${selectedSymbol} with timeframe ${timeframe}`);
          const response = await fetch(`/api/volume-analysis?symbol=${selectedSymbol}&timeframe=${timeframe}`);
          const data = await response.json();
          
          // Store in local cache
          if (!dataCache.current[selectedSymbol]) {
            dataCache.current[selectedSymbol] = {};
          }
          
          dataCache.current[selectedSymbol][timeframe] = {
            timeSeriesData: data.timeSeriesData,
            significantMoves: data.significantMoves,
            timestamp: Date.now()
          };
          
          // Store in persistent cache for rate-limited scenarios
          companyDataCache.set(selectedSymbol, {
            timeSeriesData: data.timeSeriesData,
            significantMoves: data.significantMoves
          });
          
          // Store in IndexedDB
          try {
            await stockDB.saveStockData({
              symbol: selectedSymbol,
              timeSeriesData: data.timeSeriesData,
              significantMoves: data.significantMoves,
              lastUpdated: Date.now()
            });
          } catch (dbError) {
            console.error('Error saving stock data to IndexedDB:', dbError);
          }
          
          // If this is 3m data, it can be used for 1w and 1m as well
          if (timeframe === '3m') {
            // Store filtered versions for 1w and 1m
            cacheFilteredData(selectedSymbol, data.timeSeriesData, data.significantMoves);
          }
          
          setTimeSeriesData(data.timeSeriesData);
          setSignificantMoves(data.significantMoves);
        } else {
          // Use cached data
          console.log(`Using cached data for ${selectedSymbol} with timeframe ${timeframe}`);
          const cachedData = dataCache.current[selectedSymbol][timeframe];
          setTimeSeriesData(cachedData.timeSeriesData);
          setSignificantMoves(cachedData.significantMoves);
        }
      } catch (error) {
        console.error('Error fetching volume data:', error);
        
        // Try to use cached data if available
        const cachedData = companyDataCache.get(selectedSymbol);
        if (cachedData?.timeSeriesData?.length) {
          // Ensure significant moves have all required properties
          const safeSignificantMoves = (cachedData.significantMoves || []).map(move => ({
            date: move.date || '',
            volume: typeof move.volume === 'number' ? move.volume : 0,
            price: typeof move.price === 'number' ? move.price : 0,
            priceChange: typeof move.priceChange === 'number' ? move.priceChange : 0,
            percentageChange: typeof move.percentageChange === 'number' ? move.percentageChange : 0,
            previousClose: typeof move.previousClose === 'number' ? move.previousClose : 0,
            high: typeof move.high === 'number' ? move.high : 0, 
            low: typeof move.low === 'number' ? move.low : 0,
            news: Array.isArray(move.news) ? move.news : []
          }));
          
          setTimeSeriesData(cachedData.timeSeriesData);
          setSignificantMoves(safeSignificantMoves);
        } else {
          setTimeSeriesData([]);
          setSignificantMoves([]);
        }
      } finally {
        setIsVolumeLoading(false);
      }
    };

    fetchVolumeData();
  }, [selectedSymbol, timeframe]);
  
  // Initial 3-month data fetch when symbol changes
  useEffect(() => {
    const fetchInitialData = async () => {
      if (!selectedSymbol) return;
      
      // Don't fetch if we already have this data cached
      if (dataCache.current[selectedSymbol]?.[defaultTimeframeRef.current]) {
        return;
      }
      
      // Check IndexedDB first
      try {
        const dbStockData = await stockDB.getStockData(selectedSymbol);
        if (dbStockData && dbStockData.timeSeriesData.length > 0) {
          // Update our in-memory cache with the data
          if (!dataCache.current[selectedSymbol]) {
            dataCache.current[selectedSymbol] = {};
          }
          
          dataCache.current[selectedSymbol][defaultTimeframeRef.current] = {
            timeSeriesData: dbStockData.timeSeriesData,
            significantMoves: dbStockData.significantMoves,
            timestamp: dbStockData.lastUpdated
          };
          
          // Create filtered versions for other timeframes
          cacheFilteredData(selectedSymbol, dbStockData.timeSeriesData, dbStockData.significantMoves);
          
          // If current timeframe is 3m or shorter, update displayed data
          if (['1w', '1m', '3m'].includes(timeframe)) {
            // Filter the data based on current timeframe
            const filteredData = getFilteredDataForTimeframe(
              dbStockData.timeSeriesData, 
              dbStockData.significantMoves,
              timeframe
            );
            
            setTimeSeriesData(filteredData.timeSeriesData);
            setSignificantMoves(filteredData.significantMoves);
          }
          
          // If data is less than 24 hours old, don't fetch new data
          const dataAge = Date.now() - dbStockData.lastUpdated;
          if (dataAge < 86400000) { // 24 hours in milliseconds
            return;
          }
        }
      } catch (dbError) {
        console.error('Error accessing IndexedDB in initial data fetch:', dbError);
      }
      
      setIsVolumeLoading(true);
      try {
        console.log(`Fetching initial 3-month data for ${selectedSymbol}`);
        const response = await fetch(`/api/volume-analysis?symbol=${selectedSymbol}&timeframe=${defaultTimeframeRef.current}`);
        const data = await response.json();
        
        // Store in cache
        if (!dataCache.current[selectedSymbol]) {
          dataCache.current[selectedSymbol] = {};
        }
        
        dataCache.current[selectedSymbol][defaultTimeframeRef.current] = {
          timeSeriesData: data.timeSeriesData,
          significantMoves: data.significantMoves,
          timestamp: Date.now()
        };
        
        // Store in IndexedDB
        try {
          await stockDB.saveStockData({
            symbol: selectedSymbol,
            timeSeriesData: data.timeSeriesData,
            significantMoves: data.significantMoves,
            lastUpdated: Date.now()
          });
        } catch (dbError) {
          console.error('Error saving initial stock data to IndexedDB:', dbError);
        }
        
        // Create filtered versions for 1w and 1m
        cacheFilteredData(selectedSymbol, data.timeSeriesData, data.significantMoves);
        
        // If current timeframe is 3m or shorter, update displayed data
        if (['1w', '1m', '3m'].includes(timeframe)) {
          // Filter the data based on current timeframe
          const filteredData = getFilteredDataForTimeframe(
            data.timeSeriesData, 
            data.significantMoves,
            timeframe
          );
          
          setTimeSeriesData(filteredData.timeSeriesData);
          setSignificantMoves(filteredData.significantMoves);
        }
      } catch (error) {
        console.error('Error fetching initial volume data:', error);
      } finally {
        setIsVolumeLoading(false);
      }
    };

    fetchInitialData();
  }, [selectedSymbol]);

  // Helper function to filter 3m data for shorter timeframes and cache it
  const cacheFilteredData = (symbol: string, allData: TimeSeriesData[], allMoves: SignificantMove[]) => {
    // Filter for 1-week data
    const oneWeekData = getFilteredDataForTimeframe(allData, allMoves, '1w');
    dataCache.current[symbol]['1w'] = {
      timeSeriesData: oneWeekData.timeSeriesData,
      significantMoves: oneWeekData.significantMoves,
      timestamp: Date.now()
    };
    
    // Filter for 1-month data
    const oneMonthData = getFilteredDataForTimeframe(allData, allMoves, '1m');
    dataCache.current[symbol]['1m'] = {
      timeSeriesData: oneMonthData.timeSeriesData,
      significantMoves: oneMonthData.significantMoves,
      timestamp: Date.now()
    };
  };
  
  // Helper function to filter data based on timeframe
  const getFilteredDataForTimeframe = (
    allData: TimeSeriesData[], 
    allMoves: SignificantMove[],
    tf: Timeframe
  ) => {
    let daysToInclude: number;
    
    // Determine how many days to include based on timeframe
    switch (tf) {
      case '1w': daysToInclude = 7; break;
      case '1m': daysToInclude = 30; break;
      default: return { timeSeriesData: allData, significantMoves: allMoves };
    }
    
    // Get the cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToInclude);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];
    
    // Filter timeseries data
    const filteredTimeSeries = allData.filter(item => 
      new Date(item.date) >= new Date(cutoffStr)
    );
    
    // Filter significant moves
    const filteredMoves = allMoves.filter(item => 
      new Date(item.date) >= new Date(cutoffStr)
    );
    
    return {
      timeSeriesData: filteredTimeSeries,
      significantMoves: filteredMoves
    };
  };
  
  // Check if we need to fetch new data or can use cached data
  const shouldFetchNewData = (symbol: string, tf: Timeframe): boolean => {
    // We always need to fetch 1y and 5y data when selected
    if (tf === '1y' || tf === '5y') {
      // Check if we have cached data for this timeframe
      if (dataCache.current[symbol]?.[tf]) {
        // Check if the cache is older than 24 hours (86400000 ms)
        const cacheAge = Date.now() - dataCache.current[symbol][tf].timestamp;
        return cacheAge > 86400000; // Refresh data if older than 24 hours
      }
      return true; // No cache, need to fetch
    }
    
    // For shorter timeframes, check if we have 3m data
    if (!dataCache.current[symbol]?.[defaultTimeframeRef.current]) {
      return true; // No 3-month data, need to fetch
    }
    
    // For 1w, 1m, 3m, we can use filtered data from 3m
    return false; // No need to fetch, use cached data
  };
  
  // Cleanup old data periodically
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      try {
        stockDB.cleanupOldData(30); // Remove data older than 30 days
      } catch (error) {
        console.error('Error cleaning up old data:', error);
      }
    }, 24 * 60 * 60 * 1000); // Run once per day
    
    return () => clearInterval(cleanupInterval);
  }, []);

  const handleGenerateScript = async () => {
    if (!selectedSymbol || isGenerating) return;

    setIsGenerating(true);
    setGeneratedScript('');

    try {
      const response = await fetch('http://localhost:5044/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol: selectedSymbol,
          timeframe,
        }),
      });

      const data = await response.json();
      setGeneratedScript(data.script);
    } catch (error) {
      console.error('Error generating script:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  // Function to clear cache and fetch fresh data
  const handleClearCacheAndRefresh = async () => {
    if (!selectedSymbol) return;
    
    setIsRefreshing(true);
    let refreshSuccess = false;
    let errorMessage = '';
    
    try {
      // Clear from memory cache
      if (dataCache.current[selectedSymbol]) {
        dataCache.current[selectedSymbol] = {};
      }
      
      // Clear from company data cache
      companyDataCache.set(selectedSymbol, { symbol: selectedSymbol, name: selectedSymbol });
      
      // Reset rate limited status
      setRateLimited(false);
      
      // Force refetch company data with retry mechanism
      try {
        console.log(`Refreshing company data for ${selectedSymbol}`);
        
        // Use query parameters that force real data
        const url = `/api/company?symbol=${selectedSymbol}&force=true&mock=false`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
          throw new Error(`Server error: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Check if we actually got real data and not an error
        if (data.error) {
          throw new Error(data.error);
        }
        
        // If we get a very generic company data object, it might be mock data
        // Most real API responses have longer descriptions and more detailed info
        if (data.description && data.description.length < 50) {
          console.warn('Suspiciously short company description, might be mock data');
        }
        
        setCompanyData(data);
        console.log('Successfully refreshed company data');
      } catch (error: any) {
        console.error('Error refreshing company data:', error);
        errorMessage = `Failed to refresh company data: ${error?.message || 'Unknown error'}`;
      }
      
      // Force refetch volume data
      setIsVolumeLoading(true);
      try {
        console.log(`Refreshing volume data for ${selectedSymbol}`);
        
        // Use query parameters that force real data
        const url = `/api/volume-analysis?symbol=${selectedSymbol}&timeframe=${timeframe}&force=true&mock=false`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
          throw new Error(`Server error: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Check if we actually got real data and not an error
        if (data.error) {
          throw new Error(data.error);
        }
        
        if (!data.timeSeriesData || data.timeSeriesData.length === 0) {
          throw new Error('No time series data returned');
        }
        
        // Calculate data freshness by checking the most recent data point
        let dataIsFresh = false;
        if (data.timeSeriesData && data.timeSeriesData.length > 0) {
          const mostRecent = new Date(data.timeSeriesData[0].date);
          const daysSinceUpdate = Math.floor((Date.now() - mostRecent.getTime()) / (1000 * 60 * 60 * 24));
          console.log(`Most recent data point is from ${daysSinceUpdate} days ago`);
          dataIsFresh = daysSinceUpdate < 5; // Data should be less than 5 days old
        }
        
        if (!dataIsFresh) {
          console.warn('Data may not be fresh - might be cached or mock data');
        } else {
          console.log('Data appears to be fresh');
          refreshSuccess = true;
        }
        
        setTimeSeriesData(data.timeSeriesData);
        setSignificantMoves(data.significantMoves || []);
        
        // Update cache with fresh data
        if (!dataCache.current[selectedSymbol]) {
          dataCache.current[selectedSymbol] = {};
        }
        
        dataCache.current[selectedSymbol][timeframe] = {
          timeSeriesData: data.timeSeriesData,
          significantMoves: data.significantMoves || [],
          timestamp: Date.now()
        };
      } catch (error: any) {
        console.error('Error refreshing volume data:', error);
        errorMessage = `Failed to refresh stock data: ${error?.message || 'Unknown error'}`;
      } finally {
        setIsVolumeLoading(false);
      }
    } catch (error: any) {
      console.error('Error during refresh:', error);
      errorMessage = `General refresh error: ${error?.message || 'Unknown error'}`;
    } finally {
      setIsRefreshing(false);
      
      // Show toast message based on success/failure
      if (refreshSuccess) {
        console.log('Data successfully refreshed from APIs');
        window.alert('Data successfully refreshed with fresh data!');
      } else if (errorMessage) {
        console.error(errorMessage);
        window.alert(`Refresh error: ${errorMessage}\nPossible API rate limiting - please try again later.`);
      } else {
        window.alert('Refresh completed, but may not have retrieved fresh data from APIs.');
      }
    }
  };

  return (
    <main className="min-h-screen p-4 md:p-8">
      <section className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Stock Analysis</h1>
          <p className="text-gray-500">
            Analyze stocks, track significant price movements, and generate video scripts.
          </p>
        </div>
        
        <div className="bg-white p-6 rounded-xl shadow-sm">
          <div className="space-y-8">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-grow">
                <StockSelector onSelect={handleSymbolSelect} />
              </div>
              <div className="flex gap-2">
                <TimeframeSelector value={timeframe} onChange={setTimeframe} />
                {selectedSymbol && (
                  <button
                    onClick={handleClearCacheAndRefresh}
                    disabled={isRefreshing}
                    className={`ml-2 flex items-center gap-1 px-4 py-2 rounded-lg transition-colors ${
                      isRefreshing 
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                    title="Clear cache and fetch real-time price data"
                  >
                    <span className={`text-lg mr-1 ${isRefreshing ? 'animate-spin inline-block' : ''}`}>↻</span>
                    {isRefreshing ? 'Refreshing...' : 'Refresh Data'}
                  </button>
                )}
              </div>
            </div>
            
            {recentStocks.length > 0 && !selectedSymbol && (
              <div className="mt-4">
                <h3 className="text-sm font-medium text-gray-500 mb-2">Recent Stocks</h3>
                <div className="flex flex-wrap gap-2">
                  {recentStocks.map(symbol => (
                    <button
                      key={symbol}
                      onClick={() => handleSymbolSelect(symbol)}
                      className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded-full transition"
                    >
                      {symbol}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {companyData && (
              <CompanyInfo 
                symbol={selectedSymbol}
                companyData={companyData} 
                isLoading={isLoading} 
              />
            )}

            {/* Keep the original StockSelector visible and functional */}
            {timeSeriesData.length > 0 ? (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl font-semibold">Volume Analysis</h2>
                  <button
                    onClick={handleGenerateScript}
                    disabled={isGenerating || !selectedSymbol}
                    className={`px-4 py-2 rounded-lg transition-colors ${
                      isGenerating || !selectedSymbol
                        ? 'bg-gray-300 cursor-not-allowed'
                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                  >
                    {isGenerating ? (
                      <span className="flex items-center">
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Generating...
                      </span>
                    ) : (
                      'Generate Script'
                    )}
                  </button>
                </div>
                
                <ChartWithControls 
                  timeSeriesData={timeSeriesData} 
                  significantMoves={significantMoves} 
                />
              </div>
            ) : (
              <VolumeAnalysis 
                timeSeriesData={timeSeriesData}
                significantMoves={significantMoves}
                isLoading={isVolumeLoading} 
                onGenerateScript={handleGenerateScript}
                isGenerating={isGenerating}
                generatedScript={generatedScript}
                symbol={selectedSymbol}
              />
            )}
          </div>
        </div>
      </section>
    </main>
  );
} 