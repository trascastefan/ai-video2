/**
 * Retry Helper Utility
 * 
 * This utility provides functions to help with API retries and
 * handling rate limiting more gracefully
 */

import { setRateLimited } from './cache';

interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  retryCondition?: (error: any) => boolean;
  onRetry?: (attempt: number, delay: number) => void;
}

/**
 * Check if an error is related to rate limiting
 */
export function isRateLimitError(error: any): boolean {
  if (!error) return false;
  
  // Convert error to string for consistent checking
  const errorStr = (typeof error === 'object' ? 
    (error.message || error.toString()) : 
    String(error)).toLowerCase();
  
  // Check for common rate limit indicators
  return (
    errorStr.includes('rate limit') ||
    errorStr.includes('too many requests') ||
    errorStr.includes('429') ||
    errorStr.includes('quota exceeded') ||
    errorStr.includes('api calls exceeded') ||
    errorStr.includes('please slow down')
  );
}

/**
 * Sleep for a given number of milliseconds
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    backoffFactor = 2,
    retryCondition = (error: any) => true,
    onRetry = () => {}
  } = options;
  
  let lastError: any;
  let delay = initialDelayMs;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Check if we should retry
      if (!retryCondition(error) || attempt === maxRetries) {
        throw error;
      }
      
      // Calculate next delay with exponential backoff
      delay = Math.min(delay * backoffFactor, maxDelayMs);
      
      // Add some jitter to prevent thundering herd
      const jitter = Math.random() * 200 - 100; // ±100ms
      const finalDelay = delay + jitter;
      
      // Notify callback
      onRetry(attempt, finalDelay);
      
      // Wait before retrying
      await sleep(finalDelay);
    }
  }
  
  throw lastError;
}

/**
 * Retry a function specifically when rate limited
 */
export async function retryWhenRateLimited<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 2000,
    maxDelayMs = 60000,
    onRetry = () => {}
  } = options;
  
  try {
    return await retryWithBackoff(fn, {
      maxRetries,
      initialDelayMs,
      maxDelayMs,
      backoffFactor: 3, // More aggressive backoff for rate limits
      retryCondition: (error) => {
        const isRateLimit = isRateLimitError(error);
        if (isRateLimit) {
          setRateLimited(true);
        }
        return isRateLimit;
      },
      onRetry: (attempt, delay) => {
        onRetry(attempt, delay);
      }
    });
  } catch (error) {
    // If we failed due to rate limiting, ensure the flag is set
    if (isRateLimitError(error)) {
      setRateLimited(true);
    }
    throw error;
  }
}

/**
 * Queue for rate-limited API calls
 */
export class ApiQueue {
  private queue: Array<() => Promise<any>> = [];
  private processing = false;
  private lastCallTime = 0;
  private minDelayMs: number;
  
  constructor(callsPerSecond: number) {
    this.minDelayMs = 1000 / callsPerSecond;
  }
  
  async add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          // Ensure minimum delay between calls
          const now = Date.now();
          const timeSinceLastCall = now - this.lastCallTime;
          if (timeSinceLastCall < this.minDelayMs) {
            await sleep(this.minDelayMs - timeSinceLastCall);
          }
          
          const result = await fn();
          this.lastCallTime = Date.now();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      
      this.process();
    });
  }
  
  private async process() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) {
        await task();
      }
    }
    this.processing = false;
  }
} 