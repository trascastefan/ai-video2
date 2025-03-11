/**
 * Local database implementation using IndexedDB for persistent stock data storage
 */

import { TimeSeriesData, SignificantMove } from '../components/VolumeAnalysis';

interface StockData {
  symbol: string;
  timeSeriesData: TimeSeriesData[];
  significantMoves: SignificantMove[];
  lastUpdated: number;
}

interface CompanyProfile {
  symbol: string;
  name: string;
  description: string;
  marketCap: number;
  volume: number;
  sector: string;
  industry: string;
  lastUpdated: number;
}

class StockDatabase {
  private dbName = 'stockAnalysisDB';
  private dbVersion = 1;
  private db: IDBDatabase | null = null;
  private isInitialized = false;
  private initPromise: Promise<boolean> | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.initPromise = this.initDB();
    }
  }

  /**
   * Initialize the database
   */
  private async initDB(): Promise<boolean> {
    if (!window.indexedDB) {
      console.error('IndexedDB not supported by your browser');
      return false;
    }

    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = (event) => {
        console.error('Error opening IndexedDB', event);
        this.isInitialized = false;
        reject(false);
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        this.isInitialized = true;
        console.log('IndexedDB initialized successfully');
        resolve(true);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object stores
        if (!db.objectStoreNames.contains('stockData')) {
          const stockStore = db.createObjectStore('stockData', { keyPath: 'symbol' });
          stockStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
        }

        if (!db.objectStoreNames.contains('companyProfiles')) {
          const profileStore = db.createObjectStore('companyProfiles', { keyPath: 'symbol' });
          profileStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
        }

        if (!db.objectStoreNames.contains('metaInfo')) {
          db.createObjectStore('metaInfo', { keyPath: 'key' });
        }
      };
    });
  }

  /**
   * Ensure the database is initialized before proceeding
   */
  private async ensureInitialized(): Promise<boolean> {
    if (this.isInitialized) return true;
    if (this.initPromise) return this.initPromise;
    return false;
  }

  /**
   * Store stock data in the database
   */
  async saveStockData(data: StockData): Promise<boolean> {
    try {
      await this.ensureInitialized();
      if (!this.db) return false;

      return new Promise((resolve, reject) => {
        const transaction = this.db!.transaction(['stockData'], 'readwrite');
        const store = transaction.objectStore('stockData');

        const request = store.put({
          ...data,
          lastUpdated: Date.now()
        });

        request.onsuccess = () => resolve(true);
        request.onerror = (event) => {
          console.error('Error saving stock data', event);
          reject(false);
        };
      });
    } catch (error) {
      console.error('Failed to save stock data', error);
      return false;
    }
  }

  /**
   * Retrieve stock data from the database
   */
  async getStockData(symbol: string): Promise<StockData | null> {
    try {
      await this.ensureInitialized();
      if (!this.db) return null;

      return new Promise((resolve, reject) => {
        const transaction = this.db!.transaction(['stockData'], 'readonly');
        const store = transaction.objectStore('stockData');
        const request = store.get(symbol);

        request.onsuccess = () => {
          resolve(request.result || null);
        };

        request.onerror = (event) => {
          console.error('Error getting stock data', event);
          reject(null);
        };
      });
    } catch (error) {
      console.error('Failed to get stock data', error);
      return null;
    }
  }

  /**
   * Store company profile in the database
   */
  async saveCompanyProfile(profile: CompanyProfile): Promise<boolean> {
    try {
      await this.ensureInitialized();
      if (!this.db) return false;

      return new Promise((resolve, reject) => {
        const transaction = this.db!.transaction(['companyProfiles'], 'readwrite');
        const store = transaction.objectStore('companyProfiles');

        const request = store.put({
          ...profile,
          lastUpdated: Date.now()
        });

        request.onsuccess = () => resolve(true);
        request.onerror = (event) => {
          console.error('Error saving company profile', event);
          reject(false);
        };
      });
    } catch (error) {
      console.error('Failed to save company profile', error);
      return false;
    }
  }

  /**
   * Retrieve company profile from the database
   */
  async getCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
    try {
      await this.ensureInitialized();
      if (!this.db) return null;

      return new Promise((resolve, reject) => {
        const transaction = this.db!.transaction(['companyProfiles'], 'readonly');
        const store = transaction.objectStore('companyProfiles');
        const request = store.get(symbol);

        request.onsuccess = () => {
          resolve(request.result || null);
        };

        request.onerror = (event) => {
          console.error('Error getting company profile', event);
          reject(null);
        };
      });
    } catch (error) {
      console.error('Failed to get company profile', error);
      return null;
    }
  }

  /**
   * Get all company profiles from the database
   */
  async getAllCompanyProfiles(): Promise<CompanyProfile[]> {
    try {
      await this.ensureInitialized();
      if (!this.db) return [];

      return new Promise((resolve, reject) => {
        const transaction = this.db!.transaction(['companyProfiles'], 'readonly');
        const store = transaction.objectStore('companyProfiles');
        const request = store.getAll();

        request.onsuccess = () => {
          resolve(request.result || []);
        };

        request.onerror = (event) => {
          console.error('Error getting all company profiles', event);
          reject([]);
        };
      });
    } catch (error) {
      console.error('Failed to get all company profiles', error);
      return [];
    }
  }

  /**
   * Get recently used stocks
   */
  async getRecentStocks(limit: number = 10): Promise<string[]> {
    try {
      await this.ensureInitialized();
      if (!this.db) return [];

      return new Promise((resolve, reject) => {
        const transaction = this.db!.transaction(['stockData'], 'readonly');
        const store = transaction.objectStore('stockData');
        const index = store.index('lastUpdated');
        
        // Get all items in descending order by lastUpdated
        const request = index.openCursor(null, 'prev');
        
        const symbols: string[] = [];
        
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result;
          if (cursor && symbols.length < limit) {
            symbols.push(cursor.value.symbol);
            cursor.continue();
          } else {
            resolve(symbols);
          }
        };

        request.onerror = (event) => {
          console.error('Error getting recent stocks', event);
          reject([]);
        };
      });
    } catch (error) {
      console.error('Failed to get recent stocks', error);
      return [];
    }
  }

  /**
   * Store a metadata key-value pair
   */
  async setMetadata(key: string, value: any): Promise<boolean> {
    try {
      await this.ensureInitialized();
      if (!this.db) return false;

      return new Promise((resolve, reject) => {
        const transaction = this.db!.transaction(['metaInfo'], 'readwrite');
        const store = transaction.objectStore('metaInfo');

        const request = store.put({
          key,
          value,
          lastUpdated: Date.now()
        });

        request.onsuccess = () => resolve(true);
        request.onerror = (event) => {
          console.error('Error saving metadata', event);
          reject(false);
        };
      });
    } catch (error) {
      console.error('Failed to save metadata', error);
      return false;
    }
  }

  /**
   * Retrieve a metadata value
   */
  async getMetadata(key: string): Promise<any> {
    try {
      await this.ensureInitialized();
      if (!this.db) return null;

      return new Promise((resolve, reject) => {
        const transaction = this.db!.transaction(['metaInfo'], 'readonly');
        const store = transaction.objectStore('metaInfo');
        const request = store.get(key);

        request.onsuccess = () => {
          resolve(request.result ? request.result.value : null);
        };

        request.onerror = (event) => {
          console.error('Error getting metadata', event);
          reject(null);
        };
      });
    } catch (error) {
      console.error('Failed to get metadata', error);
      return null;
    }
  }

  /**
   * Clean up old stock data to save space
   */
  async cleanupOldData(maxAgeInDays: number = 30): Promise<number> {
    try {
      await this.ensureInitialized();
      if (!this.db) return 0;

      const cutoffDate = Date.now() - (maxAgeInDays * 24 * 60 * 60 * 1000);
      let deletedCount = 0;

      // Clean up stock data
      await new Promise<void>((resolve, reject) => {
        const transaction = this.db!.transaction(['stockData'], 'readwrite');
        const store = transaction.objectStore('stockData');
        const index = store.index('lastUpdated');
        const range = IDBKeyRange.upperBound(cutoffDate);
        
        // Delete old items
        const request = index.openCursor(range);
        
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result;
          if (cursor) {
            store.delete(cursor.primaryKey);
            deletedCount++;
            cursor.continue();
          } else {
            resolve();
          }
        };

        request.onerror = (event) => {
          console.error('Error during cleanup', event);
          reject();
        };
      });

      console.log(`Database cleanup complete, removed ${deletedCount} old records`);
      return deletedCount;
    } catch (error) {
      console.error('Failed to clean up old data', error);
      return 0;
    }
  }
}

// Create singleton instance
export const stockDB = new StockDatabase();

// Export types for use elsewhere
export type { StockData, CompanyProfile }; 