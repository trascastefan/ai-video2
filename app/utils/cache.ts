// Cache utility for storing company data with improved expiration and storage strategies

interface CachedCompanyData {
  symbol: string;
  name: string;
  timeSeriesData: any[];
  significantMoves: any[];
  companyInfo: any;
  lastUpdated: number;
  expiresAt: number; // New expiration timestamp
}

interface CacheOptions {
  expirationTime?: number; // Time in milliseconds until data expires
  priority?: 'high' | 'medium' | 'low'; // Priority level for cache retention
}

// Enhanced LRU cache for company data with expiration times and priority levels
class CompanyDataCache {
  private cache: Map<string, CachedCompanyData>;
  private maxSize: number;
  private accessOrder: string[];
  private storageAvailable: boolean;
  
  constructor(maxSize = 20) { // Increased max size from 5 to 20
    this.cache = new Map();
    this.maxSize = maxSize;
    this.accessOrder = [];
    this.storageAvailable = typeof window !== 'undefined' && 
                            typeof localStorage !== 'undefined';
    
    // Load cache from localStorage if available
    if (this.storageAvailable) {
      this.loadFromStorage();
      
      // Set up periodic cleanup of expired items
      setInterval(() => this.cleanupExpired(), 60000); // Check every minute
    }
  }

  // Get company data from cache
  get(symbol: string): CachedCompanyData | undefined {
    // First check memory cache
    let data = this.cache.get(symbol);
    
    // If not in memory cache but storage is available, try to load from localStorage
    if (!data && this.storageAvailable) {
      data = this.loadItemFromStorage(symbol);
      if (data) {
        this.cache.set(symbol, data);
      }
    }
    
    if (data) {
      // Check if data is expired
      if (data.expiresAt && data.expiresAt < Date.now()) {
        console.log(`Cache expired for ${symbol}`);
        // Keep but mark as stale by moving to end of access order
        this.accessOrder = this.accessOrder.filter(s => s !== symbol);
        this.accessOrder.push(symbol);
        return undefined;
      }
      
      // Update access order (move to front)
      this.accessOrder = this.accessOrder.filter(s => s !== symbol);
      this.accessOrder.unshift(symbol);
    }
    
    return data;
  }

  // Store company data in cache
  set(symbol: string, data: Partial<CachedCompanyData>, options: CacheOptions = {}): void {
    // Get existing data or create new entry
    const existingData = this.cache.get(symbol) || {
      symbol,
      name: '',
      timeSeriesData: [],
      significantMoves: [],
      companyInfo: null,
      lastUpdated: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000 // Default 24 hours
    };
    
    // Calculate expiration based on data type and provided options
    let expirationTime = options.expirationTime;
    if (!expirationTime) {
      // Default expiration times based on data type
      if (data.companyInfo) {
        // Company profiles change rarely - cache for 7 days
        expirationTime = 7 * 24 * 60 * 60 * 1000;
      } else if (data.timeSeriesData && data.timeSeriesData.length > 0) {
        // Price data - cache for 1 hour during market hours, longer after market close
        const now = new Date();
        const isMarketHours = now.getUTCHours() >= 13 && now.getUTCHours() < 20 && // 9AM-4PM ET
                             now.getUTCDay() > 0 && now.getUTCDay() < 6; // Mon-Fri
        expirationTime = isMarketHours ? 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
      } else {
        // Other data - default 24 hours
        expirationTime = 24 * 60 * 60 * 1000;
      }
    }
    
    // Merge new data with existing
    const updatedData = {
      ...existingData,
      ...data,
      lastUpdated: Date.now(),
      expiresAt: Date.now() + expirationTime
    };
    
    // Store updated data
    this.cache.set(symbol, updatedData);
    
    // Update access order
    this.accessOrder = this.accessOrder.filter(s => s !== symbol);
    this.accessOrder.unshift(symbol);
    
    // Save to localStorage if available
    if (this.storageAvailable) {
      this.saveItemToStorage(symbol, updatedData);
    }
    
    // Remove oldest entry if cache exceeds max size
    if (this.accessOrder.length > this.maxSize) {
      const oldest = this.accessOrder.pop();
      if (oldest) {
        this.cache.delete(oldest);
        if (this.storageAvailable) {
          this.removeItemFromStorage(oldest);
        }
      }
    }
  }

  // Clean up expired items
  private cleanupExpired(): void {
    const now = Date.now();
    Array.from(this.cache.entries()).forEach(([symbol, data]) => {
      if (data.expiresAt && data.expiresAt < now) {
        console.log(`Auto cleaning expired cache for ${symbol}`);
        // We don't immediately remove expired items; they'll be removed when they're
        // at the end of the access order and the cache reaches max size
      }
    });
  }

  // Save cache to localStorage
  private saveToStorage(): void {
    try {
      // Only store the most recently used items to avoid storage limits
      const topItems = this.accessOrder.slice(0, 10);
      const storageData = topItems.map(symbol => {
        const data = this.cache.get(symbol);
        return [symbol, data];
      });
      localStorage.setItem('companyDataCache', JSON.stringify(storageData));
    } catch (error) {
      console.error('Failed to save cache to localStorage:', error);
    }
  }

  // Save single item to storage
  private saveItemToStorage(symbol: string, data: CachedCompanyData): void {
    try {
      localStorage.setItem(`companyCache_${symbol}`, JSON.stringify(data));
    } catch (error) {
      console.error(`Failed to save ${symbol} cache to localStorage:`, error);
    }
  }

  // Remove item from storage
  private removeItemFromStorage(symbol: string): void {
    try {
      localStorage.removeItem(`companyCache_${symbol}`);
    } catch (error) {
      console.error(`Failed to remove ${symbol} from localStorage:`, error);
    }
  }

  // Load cache from localStorage
  private loadFromStorage(): void {
    try {
      // Load individual stocks (more reliable than bulk loading)
      const keys = Object.keys(localStorage);
      const cacheKeys = keys.filter(key => key.startsWith('companyCache_'));
      
      for (const key of cacheKeys) {
        const symbol = key.replace('companyCache_', '');
        this.loadItemFromStorage(symbol);
      }
    } catch (error) {
      console.error('Failed to load cache from localStorage:', error);
    }
  }

  // Load individual item from storage
  private loadItemFromStorage(symbol: string): CachedCompanyData | undefined {
    try {
      const dataStr = localStorage.getItem(`companyCache_${symbol}`);
      if (dataStr) {
        const data = JSON.parse(dataStr) as CachedCompanyData;
        this.cache.set(symbol, data);
        // Update access order without triggering cleanup
        this.accessOrder = this.accessOrder.filter(s => s !== symbol);
        this.accessOrder.push(symbol);
        return data;
      }
    } catch (error) {
      console.error(`Failed to load ${symbol} from localStorage:`, error);
    }
    return undefined;
  }

  // Get all cached company data sorted by last access
  getAll(): CachedCompanyData[] {
    return this.accessOrder.map(symbol => this.cache.get(symbol)!).filter(Boolean);
  }

  // Get all valid (non-expired) cached company data 
  getAllValid(): CachedCompanyData[] {
    const now = Date.now();
    return this.accessOrder
      .map(symbol => this.cache.get(symbol)!)
      .filter(data => data && (!data.expiresAt || data.expiresAt > now));
  }

  // Check if company exists in cache and is not expired
  has(symbol: string): boolean {
    const data = this.cache.get(symbol);
    if (!data) return false;
    if (data.expiresAt && data.expiresAt < Date.now()) return false;
    return true;
  }

  // Check if company exists in cache (even if expired)
  hasExpired(symbol: string): boolean {
    const data = this.cache.get(symbol);
    return !!data && data.expiresAt < Date.now();
  }

  // Get count of cached companies
  get size(): number {
    return this.cache.size;
  }

  // Check how much time is left before expiration
  getTimeToExpiration(symbol: string): number {
    const data = this.cache.get(symbol);
    if (!data || !data.expiresAt) return 0;
    return Math.max(0, data.expiresAt - Date.now());
  }
}

// Create singleton instance with larger capacity
export const companyDataCache = new CompanyDataCache(20);

// Function to detect if APIs are rate limited
export let isRateLimited = false;
export let rateLimitedUntil = 0;

export function setRateLimited(limited: boolean, durationMs: number = 60 * 60 * 1000): void {
  isRateLimited = limited;
  
  if (limited) {
    rateLimitedUntil = Date.now() + durationMs;
  } else {
    rateLimitedUntil = 0;
  }
  
  // Store rate limit status to session storage to persist across page refreshes
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem('isRateLimited', String(limited));
    window.sessionStorage.setItem('rateLimitedUntil', String(rateLimitedUntil));
  }
}

export function checkRateLimit(): boolean {
  if (rateLimitedUntil > 0 && Date.now() > rateLimitedUntil) {
    // Rate limit period has expired
    setRateLimited(false);
  }
  return isRateLimited;
}

// Initialize rate limit status from session storage
if (typeof window !== 'undefined') {
  const storedStatus = window.sessionStorage.getItem('isRateLimited');
  const storedUntil = window.sessionStorage.getItem('rateLimitedUntil');
  
  if (storedStatus) {
    isRateLimited = storedStatus === 'true';
  }
  
  if (storedUntil) {
    rateLimitedUntil = parseInt(storedUntil, 10);
    // Check if rate limit has expired
    if (rateLimitedUntil > 0 && Date.now() > rateLimitedUntil) {
      setRateLimited(false);
    }
  }
} 