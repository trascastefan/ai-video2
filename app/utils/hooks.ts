import { useState, useEffect, useCallback } from 'react';
import { stockDB, StockData, CompanyProfile } from './db';

/**
 * Hook to get and manage recent stock symbols
 */
export function useRecentStocks(limit: number = 10) {
  const [recentStocks, setRecentStocks] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  const fetchRecentStocks = useCallback(async () => {
    try {
      setLoading(true);
      const stocks = await stockDB.getRecentStocks(limit);
      setRecentStocks(stocks);
      setError(null);
    } catch (err) {
      console.error('Error fetching recent stocks:', err);
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [limit]);
  
  useEffect(() => {
    fetchRecentStocks();
  }, [fetchRecentStocks]);
  
  return { recentStocks, loading, error, refresh: fetchRecentStocks };
}

/**
 * Hook to get and manage stock data
 */
export function useStockData(symbol: string | null) {
  const [stockData, setStockData] = useState<StockData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  const fetchStockData = useCallback(async (sym: string) => {
    if (!sym) return;
    
    try {
      setLoading(true);
      const data = await stockDB.getStockData(sym);
      setStockData(data);
      setError(null);
    } catch (err) {
      console.error(`Error fetching stock data for ${sym}:`, err);
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);
  
  useEffect(() => {
    if (symbol) {
      fetchStockData(symbol);
    } else {
      setStockData(null);
    }
  }, [symbol, fetchStockData]);
  
  const saveData = useCallback(async (data: StockData) => {
    try {
      await stockDB.saveStockData(data);
      setStockData(data);
      return true;
    } catch (err) {
      console.error('Error saving stock data:', err);
      setError(err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }, []);
  
  return { stockData, loading, error, refresh: () => symbol && fetchStockData(symbol), saveData };
}

/**
 * Hook to get and manage company profile
 */
export function useCompanyProfile(symbol: string | null) {
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  const fetchCompanyProfile = useCallback(async (sym: string) => {
    if (!sym) return;
    
    try {
      setLoading(true);
      const profile = await stockDB.getCompanyProfile(sym);
      setCompanyProfile(profile);
      setError(null);
    } catch (err) {
      console.error(`Error fetching company profile for ${sym}:`, err);
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);
  
  useEffect(() => {
    if (symbol) {
      fetchCompanyProfile(symbol);
    } else {
      setCompanyProfile(null);
    }
  }, [symbol, fetchCompanyProfile]);
  
  const saveProfile = useCallback(async (profile: CompanyProfile) => {
    try {
      await stockDB.saveCompanyProfile(profile);
      setCompanyProfile(profile);
      return true;
    } catch (err) {
      console.error('Error saving company profile:', err);
      setError(err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }, []);
  
  return { 
    companyProfile, 
    loading, 
    error, 
    refresh: () => symbol && fetchCompanyProfile(symbol),
    saveProfile
  };
}

/**
 * Hook to cleanup old data
 */
export function useDbCleanup() {
  const [cleaning, setCleaning] = useState(false);
  const [lastCleanup, setLastCleanup] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);
  
  const cleanup = useCallback(async (maxAgeInDays: number = 30) => {
    try {
      setCleaning(true);
      const deletedCount = await stockDB.cleanupOldData(maxAgeInDays);
      setLastCleanup(new Date());
      setError(null);
      return deletedCount;
    } catch (err) {
      console.error('Error cleaning up database:', err);
      setError(err instanceof Error ? err : new Error(String(err)));
      return 0;
    } finally {
      setCleaning(false);
    }
  }, []);
  
  return { cleanup, cleaning, lastCleanup, error };
}

/**
 * Hook to get all company profiles
 */
export function useAllCompanyProfiles() {
  const [profiles, setProfiles] = useState<CompanyProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  const fetchProfiles = useCallback(async () => {
    try {
      setLoading(true);
      const allProfiles = await stockDB.getAllCompanyProfiles();
      setProfiles(allProfiles);
      setError(null);
    } catch (err) {
      console.error('Error fetching all company profiles:', err);
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);
  
  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);
  
  return { profiles, loading, error, refresh: fetchProfiles };
}

/**
 * Hook to get and set metadata
 */
export function useMetadata<T>(key: string, defaultValue: T) {
  const [value, setValue] = useState<T>(defaultValue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  const fetchMetadata = useCallback(async () => {
    try {
      setLoading(true);
      const data = await stockDB.getMetadata(key);
      setValue(data === null ? defaultValue : data);
      setError(null);
    } catch (err) {
      console.error(`Error fetching metadata for key ${key}:`, err);
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [key, defaultValue]);
  
  useEffect(() => {
    fetchMetadata();
  }, [fetchMetadata]);
  
  const saveMetadata = useCallback(async (newValue: T) => {
    try {
      await stockDB.setMetadata(key, newValue);
      setValue(newValue);
      return true;
    } catch (err) {
      console.error(`Error saving metadata for key ${key}:`, err);
      setError(err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }, [key]);
  
  return { value, loading, error, setValue: saveMetadata, refresh: fetchMetadata };
} 