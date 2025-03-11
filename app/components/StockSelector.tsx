import React, { useState, useEffect, useCallback } from 'react';
import { useDebounce } from 'use-debounce';
import { Stock } from '@/app/data/stocks';
import { companyDataCache, isRateLimited } from '@/app/utils/cache';
import { stockDB } from '@/app/utils/db'; // Import the IndexedDB database

interface StockSelectorProps {
  onSelect: (symbol: string) => void;
}

// Cache for search results
const searchCache = new Map<string, Stock[]>();

export default function StockSelector({ onSelect }: StockSelectorProps) {
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebounce(search, 300);
  const [suggestions, setSuggestions] = useState<Stock[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [rateLimited, setRateLimited] = useState(isRateLimited);
  const [recentStocks, setRecentStocks] = useState<string[]>([]);

  // Effect to check rate limit status
  useEffect(() => {
    setRateLimited(isRateLimited);
  }, [isRateLimited]);
  
  // Load recent stocks from IndexedDB
  useEffect(() => {
    const loadRecentStocks = async () => {
      try {
        const recent = await stockDB.getRecentStocks(5);
        setRecentStocks(recent);
      } catch (error) {
        console.error('Error loading recent stocks:', error);
      }
    };
    
    loadRecentStocks();
  }, []);

  const fetchSuggestions = useCallback(async (query: string) => {
    // Check cache first
    const cacheKey = query.toLowerCase();
    if (searchCache.has(cacheKey)) {
      return searchCache.get(cacheKey)!;
    }

    // If rate limited, only show cached companies
    if (rateLimited && !query) {
      try {
        // Try to get company profiles from IndexedDB first
        const profiles = await stockDB.getAllCompanyProfiles();
        if (profiles.length > 0) {
          return profiles.map(profile => ({
            symbol: profile.symbol,
            name: profile.name || profile.symbol,
            marketCap: profile.marketCap,
            sector: profile.sector || 'Unknown'
          }));
        }
      } catch (error) {
        console.error('Error getting company profiles from IndexedDB:', error);
      }
      
      // Fall back to memory cache if IndexedDB fails
      const cachedCompanies = companyDataCache.getAll();
      return cachedCompanies.map(company => ({
        symbol: company.symbol,
        name: company.name || company.symbol,
        marketCap: 0, // We don't have this info from the cache
        sector: 'Unknown' // We don't have this info from the cache
      }));
    }

    // If rate limited and query exists, filter cached companies
    if (rateLimited && query) {
      try {
        // Try to get and filter company profiles from IndexedDB first
        const profiles = await stockDB.getAllCompanyProfiles();
        if (profiles.length > 0) {
          const filteredProfiles = profiles.filter(profile => 
            profile.symbol.toLowerCase().includes(query.toLowerCase()) || 
            (profile.name && profile.name.toLowerCase().includes(query.toLowerCase()))
          );
          
          return filteredProfiles.map(profile => ({
            symbol: profile.symbol,
            name: profile.name,
            marketCap: profile.marketCap,
            sector: profile.sector || 'Unknown'
          }));
        }
      } catch (error) {
        console.error('Error filtering company profiles from IndexedDB:', error);
      }
      
      // Fall back to memory cache if IndexedDB fails
      const cachedCompanies = companyDataCache.getAll();
      const filteredCompanies = cachedCompanies.filter(company => 
        company.symbol.toLowerCase().includes(query.toLowerCase()) || 
        (company.name && company.name.toLowerCase().includes(query.toLowerCase()))
      );
      
      return filteredCompanies.map(company => ({
        symbol: company.symbol,
        name: company.name || company.symbol,
        marketCap: 0,
        sector: 'Unknown'
      }));
    }

    // Not rate limited, proceed with normal API call
    const response = await fetch(`/api/search?query=${encodeURIComponent(query)}`);
    if (!response.ok) {
      throw new Error('Failed to fetch suggestions');
    }
    const data = await response.json();
    
    // Cache the results
    searchCache.set(cacheKey, data);
    return data;
  }, [rateLimited]);

  useEffect(() => {
    const getSuggestions = async () => {
      if (!debouncedSearch && !rateLimited) {
        setSuggestions([]);
        return;
      }

      setIsLoading(true);
      try {
        const data = await fetchSuggestions(debouncedSearch);
        setSuggestions(data);
      } catch (error) {
        console.error('Error fetching suggestions:', error);
        setSuggestions([]);
      } finally {
        setIsLoading(false);
      }
    };

    getSuggestions();
  }, [debouncedSearch, fetchSuggestions, rateLimited]);

  return (
    <div className="relative w-full">
      <input
        type="text"
        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        placeholder={rateLimited ? "Search recently used stocks..." : "Search for a company or ticker..."}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
      />
      
      {rateLimited && (
        <div className="text-xs text-orange-500 mt-1">
          API rate limited - showing recently used stocks only
        </div>
      )}
      
      {isOpen && ((search || rateLimited) || isLoading) && (
        <div className="absolute w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto z-50">
          {isLoading ? (
            <div className="p-4 text-center text-gray-500">
              Loading...
            </div>
          ) : suggestions.length > 0 ? (
            <ul>
              {suggestions.map((stock) => (
                <li
                  key={stock.symbol}
                  className="px-4 py-2 hover:bg-gray-100 cursor-pointer"
                  onClick={() => {
                    onSelect(stock.symbol);
                    setSearch(`${stock.name} (${stock.symbol})`);
                    setIsOpen(false);
                  }}
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="font-medium">{stock.name}</span>
                      <span className="text-gray-500 ml-2">({stock.symbol})</span>
                    </div>
                    {stock.sector !== 'Unknown' && (
                      <span className="text-sm text-gray-500">{stock.sector}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-4 text-center text-gray-500">
              {rateLimited 
                ? "No recent stocks found" 
                : "No results found"}
            </div>
          )}
        </div>
      )}
      
      {!search && recentStocks.length > 0 && !isOpen && (
        <div className="mt-2">
          <div className="text-xs text-gray-500 mb-1">Recently viewed:</div>
          <div className="flex flex-wrap gap-1">
            {recentStocks.map(symbol => (
              <button
                key={symbol}
                onClick={() => onSelect(symbol)}
                className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded-md transition"
              >
                {symbol}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
} 