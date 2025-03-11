/**
 * Smart request queue to handle API rate limits
 * This provides a centralized way to manage API requests and respect rate limits
 */

type QueuedRequest<T> = {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
  priority: number;
  timestamp: number;
};

export class APIRequestQueue {
  private queue: Array<QueuedRequest<any>> = [];
  private processing = false;
  private requestsPerMinute: number;
  private minDelayMs: number;
  private lastRequestTime: number = 0;
  private name: string;
  
  /**
   * Creates a new request queue
   * @param name Identifier for this queue (for logging)
   * @param requestsPerMinute Maximum requests allowed per minute
   * @param minDelayMs Minimum delay between requests (in milliseconds)
   */
  constructor(name: string, requestsPerMinute: number = 5, minDelayMs: number = 200) {
    this.name = name;
    this.requestsPerMinute = requestsPerMinute;
    this.minDelayMs = minDelayMs;
    
    // Initialize processing state
    this.processing = false;
  }
  
  /**
   * Add a request to the queue with the specified priority
   * @param requestFn Function that executes the API request
   * @param priority Priority level (higher = more important)
   * @returns Promise that resolves with the result of the request
   */
  enqueue<T>(requestFn: () => Promise<T>, priority: number = 1): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      // Create a request object
      const request: QueuedRequest<T> = {
        execute: requestFn,
        resolve,
        reject,
        priority,
        timestamp: Date.now()
      };
      
      // Add to queue
      this.queue.push(request);
      
      // Sort queue by priority (higher first) then by timestamp (older first)
      this.queue.sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority; // Higher priority first
        }
        return a.timestamp - b.timestamp; // Older requests first
      });
      
      // Start processing if not already doing so
      if (!this.processing) {
        this.processQueue();
      }
    });
  }
  
  /**
   * Process the next request in the queue
   */
  private async processQueue() {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }
    
    this.processing = true;
    
    // Calculate delay based on rate limit
    const timeSinceLastRequest = Date.now() - this.lastRequestTime;
    const delay = Math.max(
      this.minDelayMs,
      (60000 / this.requestsPerMinute) - timeSinceLastRequest
    );
    
    // Wait if needed
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    // Get the next request
    const request = this.queue.shift();
    if (!request) {
      this.processQueue();
      return;
    }
    
    // Log request if timeout is significant
    if (delay > 500) {
      console.log(`[${this.name}] Executing request after ${delay}ms delay (${this.queue.length} remaining)`);
    }
    
    // Execute the request
    try {
      this.lastRequestTime = Date.now();
      const result = await request.execute();
      request.resolve(result);
    } catch (error) {
      // Check if it's a rate limit error
      if (error && (
          (typeof error === 'object' && 
           ('message' in error) && 
           (String(error.message).toLowerCase().includes('rate limit') || 
            String(error.message).toLowerCase().includes('too many requests'))) ||
          (typeof error === 'string' && 
           (error.toLowerCase().includes('rate limit') || 
            error.toLowerCase().includes('too many requests')))
      )) {
        console.warn(`[${this.name}] Rate limit hit, adding request back to queue with delay`);
        
        // Wait longer and retry this request with higher priority
        setTimeout(() => {
          this.enqueue(request.execute, request.priority + 1);
        }, 10000); // 10 second delay before retrying
        
        request.reject(new Error(`Rate limit hit for ${this.name} API`));
      } else {
        // If it's not a rate limit error, just reject normally
        request.reject(error);
      }
    }
    
    // Process the next request
    this.processQueue();
  }
  
  /**
   * Get the current queue length
   */
  get length(): number {
    return this.queue.length;
  }
  
  /**
   * Check if the queue is currently busy
   */
  get isBusy(): boolean {
    return this.processing;
  }
  
  /**
   * Clear all pending requests
   */
  clear(): number {
    const count = this.queue.length;
    this.queue.forEach(request => {
      request.reject(new Error('Queue cleared'));
    });
    this.queue = [];
    return count;
  }
}

// Create singleton instances for different APIs
export const finnhubQueue = new APIRequestQueue('Finnhub', 30, 200); // 30 requests/minute
export const alphaVantageQueue = new APIRequestQueue('AlphaVantage', 5, 500); // 5 requests/minute 