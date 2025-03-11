'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { TimeSeriesData, SignificantMove } from './VolumeAnalysis';
import { ApexOptions } from 'apexcharts';
import IPhoneMockup from './IPhoneMockup';

// Use a more robust dynamic import config with fallback and improved loading strategy
const Chart = dynamic(
  () => import('react-apexcharts').then((mod) => {
    // Ensure the component is properly loaded
    return mod.default || mod;
  }),
  { 
    ssr: false,
    loading: () => <div className="h-[500px] flex items-center justify-center">Loading chart...</div>
  }
);

interface StockChartProps {
  data: TimeSeriesData[];
  significantMoves?: SignificantMove[]; // Add significant moves data
  isPlaying: boolean;
  playbackSpeed?: number; // in milliseconds
  onAnimationComplete?: () => void; // Callback when animation finishes
}

interface TickData {
  price: number;
  timestamp: number;
}

interface ChartDataPoint extends TimeSeriesData {
  opacity?: number; // Control visibility of candles
  tickData?: TickData[]; // Tick-by-tick price data for animation
  currentTick?: number; // Current tick index during animation
}

interface ChartMetadata {
  totalCalendarDays: number; // Total days in the timeframe
  nonTradingDays: number; // Days with no trading
  displayDays: number; // Days displayed on chart (no gaps)
  minPrice: number;
  maxPrice: number;
  startDate: number; // timestamp
  endDate: number; // timestamp
  sortedData: ChartDataPoint[];
}

// Helper function to format volume numbers
const formatVolume = (volume: number): string => {
  if (volume >= 1e9) return (volume / 1e9).toFixed(2) + 'B';
  if (volume >= 1e6) return (volume / 1e6).toFixed(2) + 'M';
  if (volume >= 1e3) return (volume / 1e3).toFixed(2) + 'K';
  return volume.toString();
};

export default function StockChart({ 
  data = [], 
  significantMoves = [], 
  isPlaying, 
  playbackSpeed = 100,
  onAnimationComplete
}: StockChartProps) {
  const [visibleDataPoints, setVisibleDataPoints] = useState<ChartDataPoint[]>([]);
  const [currentTickPrice, setCurrentTickPrice] = useState<number | null>(null);
  const [chartMetadata, setChartMetadata] = useState<ChartMetadata | null>(null);
  const [chartInitialized, setChartInitialized] = useState(false);
  const animationRef = useRef<number>();
  const currentIndexRef = useRef<number>(0);
  const [activeTooltip, setActiveTooltip] = useState<{ 
    content: string;
    x: number;
    y: number;
  } | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const currentCandleIndexRef = useRef<number>(0);
  const currentTickIndexRef = useRef<number>(0);

  // Reset animation when data changes
  useEffect(() => {
    setVisibleDataPoints([]);
    setChartInitialized(false);
    currentIndexRef.current = -1;
    
    // Process data and generate chart metadata when data changes
    if (data.length > 0) {
      calculateChartMetadata();
    }
  }, [data]);

  // Step 1-4: Calculate chart metadata including total days, non-trading days, display days, min/max prices
  const calculateChartMetadata = () => {
    if (!data?.length) return;
    
    // Filter out invalid data points and sort chronologically
    const validData = data.filter(d => d && d.date && d.open && d.high && d.low && d.close);
    const sortedData = [...validData].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    // Since we'll only show trading days with data (no weekend gaps):
    // We're not using calendar days anymore, just the actual trading days
    const startDate = new Date(sortedData[0].date);
    const endDate = new Date(sortedData[sortedData.length - 1].date);
    
    // We still calculate these for informational purposes, but they don't affect the chart display
    const totalCalendarDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const nonTradingDays = totalCalendarDays - sortedData.length;
    
    // Calculate price range with padding
    const minPrice = Math.min(...sortedData.map(d => d.low));
    const maxPrice = Math.max(...sortedData.map(d => d.high));
    const priceRange = maxPrice - minPrice;
    const priceMargin = priceRange * 0.15; // 15% margin for better visualization
    
    // Generate realistic tick data for each candle
    const dataWithTicks = sortedData.map(point => {
      const tickData = generateRealisticTickData(point);
      return {
        ...point,
        opacity: 0, // Start with all candles hidden
        tickData
      };
    });
    
    // Create metadata for chart rendering
    const metadata: ChartMetadata = {
      totalCalendarDays,
      nonTradingDays,
      displayDays: sortedData.length, // Days that will be displayed on chart
      minPrice: minPrice - priceMargin,
      maxPrice: maxPrice + priceMargin,
      startDate: startDate.getTime(),
      endDate: endDate.getTime(),
      sortedData: dataWithTicks
    };
    
    console.log('Chart metadata calculated:', {
      totalCalendarDays: metadata.totalCalendarDays,
      nonTradingDays: metadata.nonTradingDays,
      displayDays: metadata.displayDays,
      priceRange: [metadata.minPrice, metadata.maxPrice]
    });
    
    setChartMetadata(metadata);
    
    // Initialize chart with empty candles
    initializeEmptyChart(metadata);
  };

  // Function to generate realistic tick data for a candlestick with various market patterns
  const generateRealisticTickData = (candle: TimeSeriesData): TickData[] => {
    const { open, high, low, close } = candle;
    const priceRange = high - low; // Renamed to avoid duplicate declaration
    
    // Adaptive tick count with increased data points for more detailed intra-day evolution
    let numTicks = 150; // Significantly more data points for richer intra-day details
    
    // For more volatile candles, use even more ticks to show the movement better
    if (priceRange > 0.05 * open) { // Higher volatility (>5% range)
      numTicks = 200; // Much higher resolution for volatile candles
    } else if (priceRange < 0.01 * open) { // Very low volatility (<1% range)
      numTicks = 120; // Fewer ticks but still detailed enough for low volatility
    }
    const tickData: TickData[] = [];
    
    // Determine if this is an uptrend or downtrend candle
    const isUptrend = close > open;
    const isDoji = Math.abs(close - open) < (high - low) * 0.1;
    const candleDate = new Date(candle.date);
    const openTime = candleDate.getTime();
    const closeTime = openTime + (24 * 60 * 60 * 1000) - 1; // End of day
    
    // Calculate price ranges for context
    const range = high - low;
    const bodyRange = Math.abs(close - open);
    const upperWick = isUptrend ? high - close : high - open;
    const lowerWick = isUptrend ? open - low : close - low;
    
    // Select a realistic market pattern based on candlestick characteristics
    // Each stock and each day has different behavior patterns
    let patternType: string;
    
    if (isDoji) {
      // For doji candlesticks (small body)
      const patternTypes = ['consolidation', 'volatileRange', 'testingLevels'];
      patternType = patternTypes[Math.floor(Math.random() * patternTypes.length)];
    } else if (isUptrend) {
      // For bullish candlesticks
      if (upperWick > bodyRange * 0.8) {
        // Large upper wick - attempted breakout but failed
        const patternTypes = ['failedBreakout', 'morningRun', 'lateReversal'];
        patternType = patternTypes[Math.floor(Math.random() * patternTypes.length)];
      } else if (lowerWick > bodyRange * 0.8) {
        // Large lower wick - tested support and bounced
        const patternTypes = ['supportBounce', 'vRecovery', 'slowClimb'];
        patternType = patternTypes[Math.floor(Math.random() * patternTypes.length)];
      } else {
        // Strong bullish candle
        const patternTypes = ['steadyUptrend', 'acceleratingRally', 'buyingClimax'];
        patternType = patternTypes[Math.floor(Math.random() * patternTypes.length)];
      }
    } else {
      // For bearish candlesticks
      if (upperWick > bodyRange * 0.8) {
        // Large upper wick - tested resistance and dropped
        const patternTypes = ['resistanceFailure', 'morningDrop', 'failedRally'];
        patternType = patternTypes[Math.floor(Math.random() * patternTypes.length)];
      } else if (lowerWick > bodyRange * 0.8) {
        // Large lower wick - attempted breakdown but recovered some
        const patternTypes = ['weakBreakdown', 'lunchDip', 'lateSupport'];
        patternType = patternTypes[Math.floor(Math.random() * patternTypes.length)];
      } else {
        // Strong bearish candle
        const patternTypes = ['steadyDowntrend', 'acceleratingDrops', 'sellingPanic'];
        patternType = patternTypes[Math.floor(Math.random() * patternTypes.length)];
      }
    }
    
    console.log(`Generating ${isUptrend ? 'bullish' : 'bearish'} candlestick with '${patternType}' pattern`);
    
    // Generate price actions based on the selected pattern
    const priceActions: number[] = [];
    
    // Normalize prices relative to open (0)
    const normalizedOpen = 0;
    const normalizedClose = isUptrend ? 1 : -1; // Normalize direction
    const normalizedHigh = (high - open) / range;
    const normalizedLow = (low - open) / range;
    
    // Calculate where in the candle range the close is (percentage from low to high)
    // This helps with determining gradual price paths
    const relativeClosePosition = isUptrend ?
      (close - low) / (high - low) : // For uptrend: how far up from low
      (high - close) / (high - low); // For downtrend: how far down from high
    
    // Helper functions for smooth price transitions
    const smoothStep = (x: number) => x * x * (3 - 2 * x);
    const smootherStep = (x: number) => x * x * x * (x * (x * 6 - 15) + 10);
    const easeInOutQuad = (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const easeInOutCubic = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const easeOutElastic = (t: number) => {
      const c4 = (2 * Math.PI) / 3;
      return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    };
    
    // Enhanced price momentum system with stronger inertia and limited movement per frame
    let priceVelocity = 0; // Initial velocity is zero
    let lastPrice = normalizedOpen; // Start at the open price
    let previousPrice = normalizedOpen; // Track previous price for limiting changes
    
    // Function to apply enhanced momentum-based price evolution with strict limits on change per frame
    const applyMomentum = (targetPrice: number, t: number): number => {
      // Parameters controlling momentum behavior
      const inertia = 0.94; // Increased inertia for more persistent continuation (was 0.88)
      const attraction = 0.06; // Reduced attraction for more gradual changes (was 0.10)
      const maxAcceleration = 0.04; // Lower acceleration limit for gentler changes (was 0.06)
      const finalBias = 0.15 * t; // Bias toward final price as we approach end
      
      // Store previous price before updating
      previousPrice = lastPrice;
      
      // Calculate force toward target price with increasing bias toward close as we progress
      const targetBias = t < 0.8 ? targetPrice : targetPrice * (1 - finalBias) + normalizedClose * finalBias;
      
      // Apply a force toward the target
      const force = (targetBias - lastPrice) * attraction;
      
      // Limit the maximum acceleration to prevent abrupt changes
      const clampedForce = Math.max(-maxAcceleration, Math.min(maxAcceleration, force));
      
      // Update velocity with stronger inertia and new force
      priceVelocity = priceVelocity * inertia + clampedForce;
      
      // Calculate the new potential position based on velocity
      const potentialNewPrice = lastPrice + priceVelocity;
      
      // CRITICAL: Limit change to maximum 10% of the day's high-low range per frame
      // First convert to the absolute scale
      const maxChangePerFrame = 0.10; // 10% of day's range maximum change
      const normalizedMaxChange = Math.abs(normalizedHigh - normalizedLow) * maxChangePerFrame;
      
      // Limit the change between frames
      const change = potentialNewPrice - previousPrice;
      const limitedChange = Math.max(-normalizedMaxChange, Math.min(normalizedMaxChange, change));
      
      // Apply the limited change
      lastPrice = previousPrice + limitedChange;
      
      // Ensure we don't exceed extreme values
      lastPrice = Math.max(normalizedLow * 1.02, Math.min(normalizedHigh * 0.98, lastPrice));
      
      return lastPrice;
    };
    
    // Function to get price based on the selected pattern
    const generatePatternPrice = (tickIndex: number): number => {
      const t = tickIndex / (numTicks - 1); // Normalized time 0 to 1
      let normalizedPrice = 0;
      
      switch (patternType) {
        // Bullish patterns
        case 'steadyUptrend':
          // Gradual, consistent rise with mini-cycles
          normalizedPrice = normalizedOpen + t * normalizedClose;
          // Add small gentle waves that don't reverse the main trend
          normalizedPrice += Math.sin(t * Math.PI * 5) * 0.08 * (1-t);
          // Add smaller random jitters for micro-realism
          normalizedPrice += (Math.random() - 0.5) * 0.1 * t;
          break;
          
        case 'acceleratingRally':
          // Starts slow, accelerates upward
          normalizedPrice = normalizedOpen + smootherStep(t) * normalizedClose;
          // More volatility as it rises
          normalizedPrice += (Math.random() - 0.4) * 0.3 * t;
          break;
          
        case 'buyingClimax':
          // Rapid rise to climax then slight pullback
          if (t < 0.7) {
            normalizedPrice = normalizedOpen + (t / 0.7) * 1.1 * normalizedClose;
          } else {
            normalizedPrice = normalizedOpen + (1.1 - 0.2 * ((t - 0.7) / 0.3)) * normalizedClose;
          }
          normalizedPrice += (Math.random() - 0.5) * 0.25;
          break;
          
        case 'morningRun':
          // Early strength then consolidation
          if (t < 0.4) {
            normalizedPrice = normalizedOpen + (t / 0.4) * normalizedHigh;
          } else {
            // Fade from high toward close
            normalizedPrice = normalizedHigh - (t - 0.4) * (normalizedHigh - normalizedClose) / 0.6;
          }
          normalizedPrice += (Math.random() - 0.5) * 0.2;
          break;
          
        case 'supportBounce':
          // Drops to support then bounces strongly
          if (t < 0.3) {
            normalizedPrice = normalizedOpen - t * (normalizedOpen - normalizedLow) / 0.3;
          } else {
            normalizedPrice = normalizedLow + (t - 0.3) * (normalizedClose - normalizedLow) / 0.7;
          }
          normalizedPrice += (Math.random() - 0.5) * 0.15;
          break;
          
        case 'vRecovery':
          // V-shaped recovery
          if (t < 0.5) {
            normalizedPrice = normalizedOpen - t * (normalizedOpen - normalizedLow) / 0.5;
          } else {
            normalizedPrice = normalizedLow + (t - 0.5) * (normalizedClose - normalizedLow) / 0.5;
          }
          normalizedPrice += (Math.random() - 0.5) * 0.1;
          break;
          
        // Bearish patterns
        case 'steadyDowntrend':
          // Gradual, consistent decline
          normalizedPrice = normalizedOpen + t * normalizedClose;
          // Add small random jitters for realism
          normalizedPrice += (Math.random() - 0.5) * 0.2 * t;
          break;
          
        case 'acceleratingDrops':
          // Starts slow, accelerates downward
          normalizedPrice = normalizedOpen + smootherStep(t) * normalizedClose;
          // More volatility as it falls
          normalizedPrice += (Math.random() - 0.6) * 0.3 * t;
          break;
          
        case 'sellingPanic':
          // Gradual then panic selling
          if (t < 0.5) {
            normalizedPrice = normalizedOpen + t * 0.3 * normalizedClose;
          } else {
            normalizedPrice = normalizedOpen + (0.3 + 0.7 * (t - 0.5) / 0.5) * normalizedClose;
          }
          normalizedPrice += (Math.random() - 0.5) * 0.25 * t;
          break;
          
        case 'resistanceFailure':
          // Tests resistance then fails
          if (t < 0.3) {
            normalizedPrice = normalizedOpen + t * (normalizedHigh - normalizedOpen) / 0.3;
          } else {
            normalizedPrice = normalizedHigh + (t - 0.3) * (normalizedClose - normalizedHigh) / 0.7;
          }
          normalizedPrice += (Math.random() - 0.5) * 0.15;
          break;
          
        case 'failedRally':
          // Attempts rally but fails
          if (t < 0.4) {
            normalizedPrice = normalizedOpen + smoothStep(t / 0.4) * 0.5 * normalizedHigh;
          } else if (t < 0.6) {
            normalizedPrice = normalizedOpen + 0.5 * normalizedHigh - (t - 0.4) * 0.2 * normalizedHigh / 0.2;
          } else {
            normalizedPrice = normalizedOpen + 0.3 * normalizedHigh + (t - 0.6) * (normalizedClose - normalizedOpen - 0.3 * normalizedHigh) / 0.4;
          }
          normalizedPrice += (Math.random() - 0.5) * 0.2;
          break;
          
        // Consolidation patterns (often doji candles)
        case 'consolidation':
          // Price moves in a tight range
          normalizedPrice = normalizedOpen + (Math.random() - 0.5) * 0.6 * range / (high - low);
          // Drift toward close over time
          normalizedPrice += t * (normalizedClose - normalizedOpen) * 0.7;
          break;
          
        case 'volatileRange':
          // Volatile but range-bound
          normalizedPrice = normalizedOpen + Math.sin(t * Math.PI * 3) * 0.4 * range / (high - low);
          // Drift toward close
          normalizedPrice += t * (normalizedClose - normalizedOpen);
          normalizedPrice += (Math.random() - 0.5) * 0.3;
          break;
          
        case 'testingLevels':
          // Tests both high and low levels but closes near open
          if (t < 0.3) {
            normalizedPrice = normalizedOpen + t * (normalizedHigh - normalizedOpen) / 0.3 * 0.8;
          } else if (t < 0.7) {
            normalizedPrice = normalizedOpen + 0.8 * normalizedHigh - (t - 0.3) * (0.8 * normalizedHigh + Math.abs(normalizedLow)) / 0.4;
          } else {
            normalizedPrice = normalizedOpen - Math.abs(normalizedLow) * 0.8 + (t - 0.7) * (normalizedClose - normalizedOpen + Math.abs(normalizedLow) * 0.8) / 0.3;
          }
          normalizedPrice += (Math.random() - 0.5) * 0.15;
          break;
          
        // Default to a simple random walk
        default:
          normalizedPrice = normalizedOpen + t * (normalizedClose - normalizedOpen);
          normalizedPrice += (Math.random() - 0.5) * 0.3;
      }
      
      // Convert normalized price back to actual price
      let actualPrice = open + normalizedPrice * range;
      
      // Ensure we stay within bounds
      actualPrice = Math.min(high, Math.max(low, actualPrice));
      
      return actualPrice;
    };
    
    // Generate tick data with momentum system for more gradual, continuous price evolution
    // Reset momentum system before starting
    priceVelocity = 0;
    lastPrice = normalizedOpen;
    
    for (let i = 0; i < numTicks; i++) {
      // Calculate time based on position in the day
      const timestamp = openTime + Math.floor((closeTime - openTime) * (i / (numTicks - 1)));
      const t = i / (numTicks - 1); // Normalized time 0 to 1
      
      // Get raw target price from pattern
      const rawPatternPrice = generatePatternPrice(i);
      
      // For critical points, use exact values
      if (i === 0) {
        // First tick is always open
        tickData.push({ price: open, timestamp });
        // Reset momentum system for new candle
        priceVelocity = 0;
        lastPrice = normalizedOpen;
        previousPrice = normalizedOpen;
      } else if (i === numTicks - 1) {
        // Last tick is always close
        tickData.push({ price: close, timestamp });
      } else {
        // Convert normalized pattern price back to the normalized scale for momentum
        const normalizedTarget = (rawPatternPrice - open) / range;
        
        // Apply enhanced momentum with strict limits on per-frame changes
        // This ensures extremely gradual and continuous price evolution
        const momentumPrice = applyMomentum(normalizedTarget, t);
        
        // Convert back to actual price
        const smoothedPrice = open + (momentumPrice * range);
        
        // Add to tick data
        tickData.push({ price: smoothedPrice, timestamp });
        
        // Verify the change between this and previous frame (for debugging)
        if (i > 1) {
          const prevPrice = tickData[i-1].price;
          const currentPrice = smoothedPrice;
          const actualChange = Math.abs(currentPrice - prevPrice);
          const maxAllowedChange = range * 0.10; // 10% of day's range
          
          // Log if we exceed the limit (shouldn't happen with our limiter)
          if (actualChange > maxAllowedChange) {
            console.log(`Warning: Price change of ${actualChange} exceeds ${maxAllowedChange} (${actualChange/range*100}% of range)`);
          }
        }
      }
    }
    
    // Make sure the first and last ticks match open and close exactly
    if (tickData.length > 0) {
      tickData[0].price = open;
      tickData[tickData.length - 1].price = close;
    }
    
    // Ensure high and low are properly represented
    // Find lowest and highest points (excluding first and last points which are fixed)
    let lowestTickIndex = 0;
    let highestTickIndex = 0;
    let lowestValue = Number.MAX_VALUE;
    let highestValue = Number.MIN_VALUE;
    
    // Find the natural low and high points (where the curve would naturally go lowest/highest)
    for (let i = 1; i < tickData.length - 1; i++) {
      if (tickData[i].price < lowestValue) {
        lowestValue = tickData[i].price;
        lowestTickIndex = i;
      }
      if (tickData[i].price > highestValue) {
        highestValue = tickData[i].price;
        highestTickIndex = i;
      }
    }
    
    // Set these points to match the exact low and high
    // This preserves the natural rhythm of the price action
    if (lowestTickIndex > 0 && lowestTickIndex < tickData.length - 1) {
      tickData[lowestTickIndex].price = low;
    }
    
    if (highestTickIndex > 0 && highestTickIndex < tickData.length - 1) {
      tickData[highestTickIndex].price = high;
    }
    
    // Track these ticks to preserve them during smoothing
    const lowestTick = tickData[lowestTickIndex];
    const highestTick = tickData[highestTickIndex];
    
    // Function to apply smoothing to the price transitions - define before using
    const smoothPriceTransitions = (priceData: TickData[]): void => {
      if (priceData.length < 5) return; // Not enough points to smooth
      
      // 1. Preserve key points that must stay fixed
      const keyPoints: {index: number, price: number}[] = [
        {index: 0, price: open}, // Open price
        {index: priceData.length - 1, price: close}, // Close price
        {index: lowestTick === priceData[0] || lowestTick === priceData[priceData.length - 1] ? 
          Math.floor(priceData.length * 0.3) : // If min is at start/end, place a synthetic low point
          priceData.indexOf(lowestTick), price: low}, // Low price
        {index: highestTick === priceData[0] || highestTick === priceData[priceData.length - 1] ? 
          Math.floor(priceData.length * 0.7) : // If max is at start/end, place a synthetic high point
          priceData.indexOf(highestTick), price: high} // High price
      ];
      
      // 2. Sort key points by index for proper interpolation
      keyPoints.sort((a, b) => a.index - b.index);
      
      // 3. Filter out any duplicate indices
      const uniqueKeyPoints = keyPoints.filter((point, index, self) => 
        index === 0 || point.index !== self[index - 1].index
      );
      
      // Apply a double-pass smoothing process
      // First pass: Apply Catmull-Rom spline interpolation between key points
      for (let i = 0; i < uniqueKeyPoints.length - 1; i++) {
        const start = uniqueKeyPoints[i];
        const end = uniqueKeyPoints[i + 1];
        
        // Skip if points are adjacent
        if (end.index - start.index <= 1) continue;
        
        // Get control points for tension
        const prevPoint = i > 0 ? uniqueKeyPoints[i - 1] : { index: start.index - 1, price: start.price };
        const nextPoint = i < uniqueKeyPoints.length - 2 ? uniqueKeyPoints[i + 2] : { index: end.index + 1, price: end.price };
        
        // Apply spline interpolation to points between key points
        for (let j = start.index + 1; j < end.index; j++) {
          const t = (j - start.index) / (end.index - start.index);
          // Smooth the t value for more natural easing
          const smoothedT = easeInOutCubic(t);
          
          // Catmull-Rom interpolation with tension
          const tension = 0.3; // Lower tension (0.3) for smoother, more gradual curves
          
          // Calculate intermediate points with Catmull-Rom
          const t0 = 0;
          const t1 = t0 + Math.sqrt(Math.pow(prevPoint.price - start.price, 2));
          const t2 = t1 + Math.sqrt(Math.pow(start.price - end.price, 2));
          const t3 = t2 + Math.sqrt(Math.pow(end.price - nextPoint.price, 2));
          
          const t1mk = 1 - tension;
          const t2mk = 1 - tension;
          
          // Adjusted t value for better control over the curve
          const tNorm = (smoothedT * (t2 - t1)) + t1;
          
          // Compute coefficients
          const a1 = t1mk * (tNorm - t0) / (t1 - t0) * start.price + 
                    t2mk * (t1 - tNorm) / (t1 - t0) * prevPoint.price;
          const a2 = t1mk * (t2 - tNorm) / (t2 - t1) * end.price + 
                    t2mk * (tNorm - t1) / (t2 - t1) * start.price;
          const a3 = t1mk * (t3 - tNorm) / (t3 - t2) * nextPoint.price + 
                    t2mk * (tNorm - t2) / (t3 - t2) * end.price;
          
          // Combine coefficients for final value with additional micro-volatility
          const b1 = t1mk * (tNorm - t0) / (t2 - t0) * a2 + t2mk * (t2 - tNorm) / (t2 - t0) * a1;
          const b2 = t1mk * (t3 - tNorm) / (t3 - t1) * a3 + t2mk * (tNorm - t1) / (t3 - t1) * a2;
          
          let interpolatedPrice = t1mk * (tNorm - t1) / (t2 - t1) * b2 + t2mk * (t2 - tNorm) / (t2 - t1) * b1;
          
          // Add directionally-biased micro-volatility that favors continuations
          // Calculate the gradient (trend direction) of the curve
          const gradientMagnitude = Math.abs(end.price - start.price) / (end.index - start.index);
          const trendDirection = Math.sign(end.price - start.price); // +1 for up, -1 for down

          // Inverse relationship - more gradient = less volatility
          const volatilityFactor = 0.0002 / (gradientMagnitude + 0.0001);
          
          // Biased random noise that's more likely to continue in current direction
          // Random noise but with a bias in the direction of the current trend
          const biasedRandom = (Math.random() - 0.4) * trendDirection;
          const microVolatility = biasedRandom * range * Math.min(Math.max(volatilityFactor, 0.0001), 0.0003);
          
          interpolatedPrice += microVolatility;
          
          // Ensure we stay within high/low bounds
          interpolatedPrice = Math.min(high, Math.max(low, interpolatedPrice));
          
          // Update the price data
          priceData[j].price = interpolatedPrice;
        }
      }
      
      // Apply a second pass with moving average smoothing
      const windowSize = Math.max(3, Math.floor(priceData.length / 20)); // Adaptive window size
      const smoothedPrices = [...priceData.map(p => p.price)]; // Copy original prices
      
      // Apply moving average smoothing except at critical points
      for (let i = 0; i < priceData.length; i++) {
        // Skip the key points (open, close, high, low)
        if (i === 0 || i === priceData.length - 1 || 
            priceData[i] === lowestTick || priceData[i] === highestTick) {
          continue;
        }
        
        // Calculate window boundaries
        const windowStart = Math.max(0, i - Math.floor(windowSize / 2));
        const windowEnd = Math.min(priceData.length - 1, i + Math.floor(windowSize / 2));
        
        // Calculate weighted moving average
        let totalWeight = 0;
        let weightedSum = 0;
        
        for (let j = windowStart; j <= windowEnd; j++) {
          // Gaussian-like weight - more weight to center points
          const distance = Math.abs(j - i);
          const weight = Math.exp(-(distance * distance) / (windowSize / 2));
          
          weightedSum += smoothedPrices[j] * weight;
          totalWeight += weight;
        }
        
        // Update with weighted average
        if (totalWeight > 0) {
          // Roll back some of the extreme smoothing for more natural price evolution
          const blendFactor = 0.65; // 65% smoothed, 35% original - better balance
          priceData[i].price = (blendFactor * (weightedSum / totalWeight)) + 
                              ((1 - blendFactor) * priceData[i].price);
        }
      }
      
      // 5. Ensure a final pass to maintain OHLC values exactly
      priceData[0].price = open;
      priceData[priceData.length - 1].price = close;
      lowestTick.price = low;
      highestTick.price = high;
      
      // Final micro-adjustments to ensure continuous first derivatives (no sharp changes)
      for (let i = 1; i < priceData.length - 1; i++) {
        const prev = priceData[i-1].price;
        const current = priceData[i].price;
        const next = priceData[i+1].price;
        
        // If there's a sudden direction change, smooth it out
        if ((current > prev && current > next) || (current < prev && current < next)) {
          // How extreme is the turning point?
          const sharpness = Math.abs((current - prev) - (next - current)) / range;
          
          // Less aggressive smoothing of sharp points to preserve some market characteristics
          if (sharpness > 0.01) { // Higher threshold - allows some natural turning points
            // Blend with average of neighbors
            const targetValue = (prev + next) / 2;
            const blendFactor = Math.min(0.5, sharpness * 10); // Less aggressive: max 50% blend
            
            // Only apply if it doesn't violate high/low constraints
            const newValue = current * (1 - blendFactor) + targetValue * blendFactor;
            if (newValue >= low && newValue <= high) {
              priceData[i].price = newValue;
            }
          }
        }
      }
    };
    
    // Apply multi-pass smoothing for extraordinary smoothness
    // First pass - basic smoothing
    smoothPriceTransitions(tickData);
    
    // Second pass - fine tune the curve (we can do this because our function preserves OHLC values)
    smoothPriceTransitions(tickData);
    
    // Apply Bezier smoothing as a final touch
    const bezierSmooth = (priceData: TickData[]): void => {
      if (priceData.length < 5) return;
      
      const tempPrices = [...priceData.map(p => p.price)];
      
      // Use one-dimensional Bezier smoothing on small segments
      for (let i = 2; i < priceData.length - 2; i++) {
        // Skip key points (open, close, high, low)
        if (i === 0 || i === priceData.length - 1 || 
            (priceData[i].price === low) || (priceData[i].price === high)) {
          continue;
        }
        
        // Control points
        const p0 = tempPrices[i-2];
        const p1 = tempPrices[i-1];
        const p2 = tempPrices[i];
        const p3 = tempPrices[i+1];
        const p4 = tempPrices[i+2];
        
        // Calculate Bezier control points
        const t = 0.5; // Center position
        
        // De Casteljau's algorithm - 5 point Bezier evaluation at t
        const q0 = p0 * (1-t) + p1 * t;
        const q1 = p1 * (1-t) + p2 * t;
        const q2 = p2 * (1-t) + p3 * t;
        const q3 = p3 * (1-t) + p4 * t;
        
        const r0 = q0 * (1-t) + q1 * t;
        const r1 = q1 * (1-t) + q2 * t;
        const r2 = q2 * (1-t) + q3 * t;
        
        const s0 = r0 * (1-t) + r1 * t;
        const s1 = r1 * (1-t) + r2 * t;
        
        // Final point on the Bezier curve
        const bezierPoint = s0 * (1-t) + s1 * t;
        
        // Subtle blend with original - apply only 30% of the Bezier smoothing
        const blendFactor = 0.3;
        priceData[i].price = priceData[i].price * (1-blendFactor) + bezierPoint * blendFactor;
      }
    };
    
    // Apply Bezier smoothing
    bezierSmooth(tickData);
  
  return tickData;
  };
  
  // Step 5: Render full graph with no visible candles
  const initializeEmptyChart = (metadata: ChartMetadata) => {
    setVisibleDataPoints(metadata.sortedData.map(point => ({
      ...point,
      opacity: 0 // All candles hidden but positioned correctly
    })));
    setChartInitialized(true);
  };

  // Step 6: Start animation to add candles chronologically with realistic tick updates
  useEffect(() => {
    // Only start animation if playing is true and chart is initialized
    if (isPlaying && chartMetadata && chartInitialized) {
      // Reset animation state
      currentIndexRef.current = -1;
      
      // Animation speed: about 0.75 seconds per candle with a total cap
      const totalCandles = chartMetadata.sortedData.length;
      const baseDuration = Math.min(totalCandles * 750, 30000); // Faster animation, cap at 30 seconds
      const speedFactor = playbackSpeed / 100;
      const candleIntervalStep = (baseDuration / totalCandles) / speedFactor;
      
      // Set the animation to exactly 90 frames per second
      const fps = 90; // 90 frames per second
      const frameDuration = 1000 / fps; // milliseconds per frame (11.11ms)
      
      // Calculate number of frames per candle based on the desired candle duration
      // Reduce the number of frames per candle to speed up the animation
      const framesPerCandle = Math.round(candleIntervalStep / frameDuration);
      
      // Ensure we're using the exact frame duration for perfect 90fps
      const tickIntervalStep = frameDuration; // exactly 11.11ms per frame
      const ticksPerCandle = Math.max(30, Math.min(framesPerCandle, 60)); // Cap frames between 30-60 for consistent speed
      
      console.log(`Starting animation: ${totalCandles} candles, ${candleIntervalStep}ms per candle, ${framesPerCandle} frames per candle, ${tickIntervalStep}ms per frame (${fps}fps)`);
      
      // Track which candle we're currently animating and which tick within that candle
      // Using refs to ensure animation state persists between renders
      let currentActiveCandles: ChartDataPoint[] = [];
      
      // Reset animation counters when starting a new animation (but not when restarting animation)
      if (currentIndexRef.current === -1) {
        currentCandleIndexRef.current = 0;
        currentTickIndexRef.current = 0;
      }
      
      // Initialize animation state - first candle with its first tick
      if (chartMetadata.sortedData.length > 0) {
        // Only initialize the data points if we're starting a new animation
        if (currentIndexRef.current === -1) {
          const initialDataPoints = chartMetadata.sortedData.map((point, index) => {
            if (index === 0) {
              // First candle is visible with its first tick
              const firstTick = point.tickData?.[0];
              return {
                ...point,
                opacity: 1,
                // Start with open values
                open: firstTick?.price || point.open,
                high: firstTick?.price || point.open,
                low: firstTick?.price || point.open,
                close: firstTick?.price || point.open,
                currentTick: 0
              };
            }
            return {
              ...point,
              opacity: 0
            };
          });
          
          currentActiveCandles = initialDataPoints;
          setVisibleDataPoints(initialDataPoints);
        }
      }
      
      // Function to update the current candle with the next tick
      const updateActiveCandleWithTick = () => {
        // Use refs to ensure animation state is maintained
        if (currentCandleIndexRef.current >= chartMetadata.sortedData.length) {
          return false; // Animation complete
        }
        
        const currentCandle = chartMetadata.sortedData[currentCandleIndexRef.current];
        const tickData = currentCandle.tickData || [];
        
        // If we've shown all ticks for this candle, move to the next candle
        if (currentTickIndexRef.current >= ticksPerCandle) {
          // Reset tick index and move to next candle
          currentTickIndexRef.current = 0;
          currentCandleIndexRef.current++;
          
          // If we're out of candles, animation is complete
          if (currentCandleIndexRef.current >= chartMetadata.sortedData.length) {
            return false; // Animation complete
          }
          
          // Make the next candle visible with its first tick
          const nextCandle = chartMetadata.sortedData[currentCandleIndexRef.current];
          const firstTick = nextCandle.tickData?.[0];
          
          // Update all active candles
          currentActiveCandles = chartMetadata.sortedData.map((point, index) => {
            if (index < currentCandleIndexRef.current) {
              // Previous candles are fully formed
              return {
                ...point,
                opacity: 1
              };
            } else if (index === currentCandleIndexRef.current) {
              // New candle starts with open values
              return {
                ...point,
                opacity: 1,
                // Start with open values
                open: firstTick?.price || point.open,
                high: firstTick?.price || point.open, 
                low: firstTick?.price || point.open,
                close: firstTick?.price || point.open,
                currentTick: 0
              };
            }
            return {
              ...point,
              opacity: 0
            };
          });
          
          setVisibleDataPoints(currentActiveCandles);
          return true; // Continue animation
        }
        
        // Calculate tick index in the full tick data array
        // Use a precise linear mapping to ensure smooth 90fps animation
        // We want to map our 90fps frames to the available tick data
        const normalizedPos = currentTickIndexRef.current / ticksPerCandle; // 0 to 1
        
        // Use an even gentler easing to preserve strong inertia
        // The smoother timing curve means less abrupt visual changes between frames
        const easedPos = normalizedPos < 0.5 ? 
                       2 * Math.pow(normalizedPos, 1.5) :
                       1 - 2 * Math.pow(1 - normalizedPos, 1.5);
                       
        const actualTickIndex = Math.floor(easedPos * (tickData.length - 1));
        if (actualTickIndex >= tickData.length) return true; // Skip to next candle if out of ticks
        
        const currentTickData = tickData[actualTickIndex];
        
        // Update the active candle with the current tick
        currentActiveCandles = chartMetadata.sortedData.map((point, index) => {
          if (index < currentCandleIndexRef.current) {
            // Previous candles are fully formed and remain unchanged
            return { ...point, opacity: 1 };
          } else if (index === currentCandleIndexRef.current) {
            // Current candle updates with the new tick
            const originalOpen = chartMetadata.sortedData[currentCandleIndexRef.current].open;
            const updatedCandle = { ...point, opacity: 1 };
            
            // Keep the original open price
            updatedCandle.open = originalOpen;
            
            // Current tick price becomes the close
            const tickPrice = currentTickData?.price || point.close;
            updatedCandle.close = tickPrice;
            
            // Store the current tick price for the tick price line visualization
            setCurrentTickPrice(tickPrice);
            
            // Update high and low if necessary
            if (actualTickIndex === 0) {
              // On first tick, high and low are the same as open
              updatedCandle.high = originalOpen;
              updatedCandle.low = originalOpen;
            } else {
              // Otherwise, update high and low if needed
              updatedCandle.high = Math.max(updatedCandle.high, tickPrice);
              updatedCandle.low = Math.min(updatedCandle.low, tickPrice);
            }
            
            return updatedCandle;
          }
          
          // Future candles remain hidden
          return { ...point, opacity: 0 };
        });
        
        // Increment tick counter
        currentTickIndexRef.current++;
        
        // Update the UI
        setVisibleDataPoints(currentActiveCandles);
        return true; // Continue animation
      };
      
      // Start the animation loop at exactly 90 FPS (11.11ms per frame)
      const tickInterval = setInterval(() => {
        const continueAnimation = updateActiveCandleWithTick();
        
        if (!continueAnimation) {
          // Animation complete
          clearInterval(tickInterval);
          console.log('Animation completed');
          
          // Reset the current tick price
          setCurrentTickPrice(null);
          
          // Show all candles in their final state
          const finalDataPoints = chartMetadata.sortedData.map(point => ({
            ...point,
            opacity: 1 // Make all visible with final OHLC values
          }));
          setVisibleDataPoints(finalDataPoints);
          
          // Notify parent component
          if (onAnimationComplete) {
            onAnimationComplete();
          }
        }
      }, tickIntervalStep);
      
      return () => {
        clearInterval(tickInterval);
        console.log('Animation stopped');
      };
    } else if (!isPlaying && chartMetadata) {
      // When stopping, show all data points in their final state
      setVisibleDataPoints(chartMetadata.sortedData.map(point => ({
        ...point,
        opacity: 1 // Make all visible with final OHLC values
      })));
    }
  }, [isPlaying, chartMetadata, chartInitialized, playbackSpeed]);

  // Initialize custom tooltip
  useEffect(() => {
    if (typeof window !== 'undefined' && !tooltipRef.current) {
      // Add custom styles for tooltip container
      const style = document.createElement('style');
      style.textContent = `
        .stock-chart-tooltip {
          position: fixed;
          z-index: 10000;
          pointer-events: none;
          opacity: 0;
          transform: translateY(5px);
          transition: opacity 0.2s ease, transform 0.2s ease;
          background: white;
          border-radius: 4px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.2);
          padding: 10px;
          min-width: 250px;
          max-width: 300px;
        }
        .stock-chart-tooltip.active {
          opacity: 1;
          transform: translateY(0);
        }
        .news-marker {
          cursor: pointer !important;
        }
      `;
      document.head.appendChild(style);
      
      // Create tooltip container once
      const tooltipContainer = document.createElement('div');
      tooltipContainer.className = 'stock-chart-tooltip';
      document.body.appendChild(tooltipContainer);
      tooltipRef.current = tooltipContainer;
      
      return () => {
        // Safely remove elements by checking if they still exist in the DOM
        if (style.parentNode === document.head) {
          document.head.removeChild(style);
        }
        
        if (tooltipContainer.parentNode === document.body) {
          document.body.removeChild(tooltipContainer);
        }
        
        tooltipRef.current = null;
      };
    }
  }, []);

  // Update tooltip visibility and position - separated from creation
  useEffect(() => {
    const tooltipContainer = tooltipRef.current;
    if (!tooltipContainer) return;
    
    if (activeTooltip) {
      tooltipContainer.innerHTML = activeTooltip.content;
      tooltipContainer.style.left = `${activeTooltip.x}px`;
      tooltipContainer.style.top = `${activeTooltip.y}px`;
      
      // Use requestAnimationFrame to avoid layout thrashing
      requestAnimationFrame(() => {
        tooltipContainer.classList.add('active');
      });
    } else {
      tooltipContainer.classList.remove('active');
    }
  }, [activeTooltip]);

  // Listen for chart marker hover events
  useEffect(() => {
    const handleMarkerMouseOver = (event: Event) => {
      const target = event.target as HTMLElement;
      if (target.closest('.news-marker')) {
        const markerId = target.closest('.news-marker')?.getAttribute('data-markerId');
        if (!markerId) return;
        
        // Find the matching marker in significantMoves
        const moveIndex = parseInt(markerId, 10);
        if (isNaN(moveIndex) || moveIndex < 0 || moveIndex >= significantMoves.length) return;
        
        const move = significantMoves[moveIndex];
        
        // Generate tooltip content
        const newsHeadlines = move.news && move.news.length > 0
          ? move.news.map(item => `• ${item.title}`).join('<br>')
          : 'No news available';
        
        let eventLabel = 'News Event';
        let labelColor = '#FF4560';
        
        // Determine event type based on price movement
        if (move.percentageChange > 3) {
          eventLabel = 'Major Rally';
          labelColor = '#00B746';
        } else if (move.percentageChange > 1) {
          eventLabel = 'Price Rise';
          labelColor = '#26C281';
        } else if (move.percentageChange < -3) {
          eventLabel = 'Major Drop';
          labelColor = '#FF4560';
        } else if (move.percentageChange < -1) {
          eventLabel = 'Price Drop';
          labelColor = '#FF9800';
        }
        
        // Check for specific news types
        if (move.news && move.news.length > 0) {
          const headlines = move.news.map(item => item.title.toLowerCase());
          
          if (headlines.some(h => h.includes('earnings') || h.includes('report'))) {
            eventLabel = 'Earnings';
          } else if (headlines.some(h => h.includes('acquisition') || h.includes('merger') || h.includes('buys'))) {
            eventLabel = 'M&A News';
          } else if (headlines.some(h => h.includes('product') || h.includes('launch') || h.includes('announce'))) {
            eventLabel = 'Product News';
          } else if (headlines.some(h => h.includes('lawsuit') || h.includes('legal'))) {
            eventLabel = 'Legal News';
          }
        }
        
        const tooltipContent = `
          <div class="news-tooltip">
            <div style="font-weight: bold; margin-bottom: 6px; color: ${labelColor};">${eventLabel}</div>
            <div style="margin-bottom: 6px;">
              <span style="color: ${move.percentageChange >= 0 ? '#26C281' : '#FF4560'}; font-weight: bold;">
                ${move.percentageChange >= 0 ? '▲' : '▼'} ${Math.abs(move.percentageChange).toFixed(2)}%
              </span>
              <span style="color: #666; margin-left: 4px;">${move.date}</span>
            </div>
            <div style="border-top: 1px solid #eee; padding-top: 6px; margin-top: 4px;">
              <div style="font-weight: bold; margin-bottom: 4px;">Headlines:</div>
              <div style="color: #333; max-height: 120px; overflow-y: auto;">
                ${newsHeadlines}
              </div>
            </div>
          </div>
        `;
        
        // Calculate tooltip position
        const rect = target.getBoundingClientRect();
        setActiveTooltip({
          content: tooltipContent,
          x: rect.right + 10,
          y: rect.top - 10
        });
      }
    };
    
    const handleMarkerMouseOut = (event: Event) => {
      const target = event.target as HTMLElement;
      if (target.closest('.news-marker')) {
        setActiveTooltip(null);
      }
    };
    
    // Use event delegation on chart container to reduce listeners
    const chartContainer = document.querySelector('.apexcharts-canvas');
    if (chartContainer) {
      chartContainer.addEventListener('mouseover', handleMarkerMouseOver);
      chartContainer.addEventListener('mouseout', handleMarkerMouseOut);
      
      return () => {
        chartContainer.removeEventListener('mouseover', handleMarkerMouseOver);
        chartContainer.removeEventListener('mouseout', handleMarkerMouseOut);
      };
    }
  }, [significantMoves]);

  // If no data is available, show a loading or empty state
  if (!data?.length) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <div className="h-[500px] flex items-center justify-center text-gray-500">
          No data available
        </div>
      </div>
    );
  }

  // Use visibleDataPoints for display which are controlled by the animation
  const displayData = visibleDataPoints.length > 0 ? visibleDataPoints : [];

  // Ensure we have valid data before creating the chart
  if (!displayData?.length) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <div className="h-[500px] flex items-center justify-center text-gray-500">
          Loading data...
        </div>
      </div>
    );
  }

  // Validate data points before creating series
  const validDataPoints = displayData.filter(point => 
    point && 
    point.date && 
    typeof point.open === 'number' && 
    typeof point.high === 'number' && 
    typeof point.low === 'number' && 
    typeof point.close === 'number'
  );

  if (!validDataPoints.length) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <div className="h-[500px] flex items-center justify-center text-gray-500">
          Invalid data format
        </div>
      </div>
    );
  }

  // Create annotation points for significant volume dates
  const annotations: ApexOptions['annotations'] = {
    points: significantMoves.map((move, index) => {
      // Add index as marker ID for event handling
      return {
        x: new Date(move.date).getTime(),
        y: move.high, // Position marker slightly above the high price
        marker: {
          size: 10, // Increased size for better hover target
          fillColor: move.percentageChange >= 0 ? '#26C281' : '#FF4560',
          strokeColor: '#fff',
          strokeWidth: 2,
          shape: 'circle',
          radius: 2,
          cssClass: `news-marker marker-${index}`,
          dataMarkerId: index.toString()
        },
        label: {
          borderColor: move.percentageChange >= 0 ? '#26C281' : '#FF4560',
          style: {
            color: '#fff',
            background: move.percentageChange >= 0 ? '#26C281' : '#FF4560',
          },
          text: move.percentageChange >= 0 ? 'Event ▲' : 'Event ▼',
          orientation: 'horizontal',
          offsetY: -15, // Move label above marker
        }
      };
    })
  };

  const chartOptions: ApexOptions = {
    chart: {
      type: 'candlestick',
      height: 500,
      animations: {
        enabled: false // Disable animations to prevent flickering
      },
      redrawOnParentResize: false,
      redrawOnWindowResize: false,
      selection: {
        enabled: false
      },
      events: {
        mounted: function(chart) {
          // Disable ApexCharts animations once the chart is mounted
          // to prevent flickering when adding new data points
          chart.w.config.chart.animations.enabled = false;
        }
      },
      toolbar: {
        show: false // Hide the toolbar completely
      },
      zoom: {
        enabled: false // Disable zoom feature
      }
    },
    title: {
      text: '',
      align: 'left'
    },
    annotations: annotations,
    tooltip: {
      enabled: true,
      shared: false, // Don't share tooltip across series
      intersect: true, // Only show tooltip when directly hovering over item
      custom: ({ seriesIndex, dataPointIndex, w }) => {
        // Only apply custom tooltips for candles, not for annotations
        if (seriesIndex === 0 && dataPointIndex !== -1) {
          const o = w.globals.seriesCandleO[0][dataPointIndex];
          const h = w.globals.seriesCandleH[0][dataPointIndex];
          const l = w.globals.seriesCandleL[0][dataPointIndex];
          const c = w.globals.seriesCandleC[0][dataPointIndex];
          
          // Get the original date from series data if available
          const seriesData = chartSeries[0].data[dataPointIndex];
          
          // Check if seriesData is an object with originalDate property
          const hasOriginalDate = seriesData && 
            typeof seriesData === 'object' && 
            'originalDate' in seriesData;
          
          const originalDate = hasOriginalDate ? (seriesData as any).originalDate : null;
          
          // Format the date nicely for the tooltip
          const formattedDate = originalDate ? 
            new Date(originalDate).toLocaleDateString('en-US', {
              weekday: 'short',
              year: 'numeric',
              month: 'short',
              day: 'numeric'
            }) : 
            w.globals.categoryLabels[dataPointIndex];
          
          return `<div class="apexcharts-tooltip-box apexcharts-tooltip-candlestick">
            <div class="font-bold">${formattedDate}</div>
            <div>Open: <span class="text-gray-800">${o.toFixed(2)}</span></div>
            <div>High: <span class="text-gray-800">${h.toFixed(2)}</span></div>
            <div>Low: <span class="text-gray-800">${l.toFixed(2)}</span></div>
            <div>Close: <span class="text-gray-800">${c.toFixed(2)}</span></div>
          </div>`;
        }
        
        return undefined;
      },
      theme: 'light'
    },
    xaxis: {
      type: 'category',
      categories: validDataPoints.map((point: { date: string }) => {
        const date = new Date(point.date);
        return date.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric',
          year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
        });
      }),
      position: 'top',
      axisTicks: { show: false },
      axisBorder: { show: false },
      labels: { show: false },
      tooltip: { enabled: false },
      crosshairs: { show: false }
    },
    yaxis: { show: false },
    grid: { show: false },
    plotOptions: {
      candlestick: {
        colors: {
          upward: '#00C176',  // Brighter green for better visibility
          downward: '#FF4560'  // Brighter red for better visibility
        },
        wick: {
          useFillColor: true
        }
      },
      bar: {
        columnWidth: '70%' // Slightly wider candles for better visibility
      }
    }
  };

  // Don't use a hook for the tick price line data, just compute it directly
  let tickPriceLineData: (number | null)[] = [];
  const canShowTickLine = isPlaying && 
    currentIndexRef.current >= 0 && 
    currentTickPrice !== null && 
    chartMetadata !== null;
    
  if (canShowTickLine && Array.isArray(data)) {
    // Create data points for all candles to show a horizontal line at the current tick price
    tickPriceLineData = data.map((point: TimeSeriesData, idx: number) => {
      // Only show the tick price line for the current candle being animated
      return idx === currentIndexRef.current ? currentTickPrice : null;
    });
  }
  
  const chartSeries = [
    {
      name: '',
      type: 'candlestick',
      data: validDataPoints.map(point => {
        const date = new Date(point.date);
        // Format the date consistently with the xaxis categories
        const formattedDate = date.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric',
          year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
        });
        
        return {
          // Using category xaxis, so x value must match the category
          x: formattedDate,
          y: [point.open, point.high, point.low, point.close],
          fillColor: point.opacity === 0 ? 'transparent' : undefined,
          strokeColor: point.opacity === 0 ? 'transparent' : undefined,
          // Store the original date for tooltips
          originalDate: point.date
        };
      })
    },
    // Add a line series to show the current tick price movement
    ...(canShowTickLine ? [{
      name: '', // Remove the 'Current Price' label
      type: 'line',
      data: tickPriceLineData,
      color: '#FFA500', // Orange color for visibility
      dashStyle: 'dash',
      lineWidth: 2,
      marker: {
        size: 5,
        fillColor: '#FFA500',
        strokeColor: '#fff',
        strokeWidth: 2
      }
    }] : [])
  ];

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <IPhoneMockup>
        <div className="flex flex-col h-full">
          {/* Chart fills the top half of the iPhone mockup */}
          <div className="h-1/2 relative">
            {typeof window !== 'undefined' && validDataPoints.length > 0 && (
              <Chart
                options={{
                  ...chartOptions,
                  chart: {
                    ...chartOptions.chart,
                    height: '100%',
                    toolbar: {
                      show: false
                    },
                    background: '#f8f9fa'
                  },
                  title: {
                    text: '', // Ensure title is empty
                    style: {
                      fontSize: '0px' // Make font size 0 to ensure it doesn't show
                    }
                  },
                  xaxis: {
                    ...chartOptions.xaxis,
                    labels: {
                      ...chartOptions.xaxis?.labels,
                      style: {
                        fontSize: '8px',
                        colors: '#333'
                      }
                    }
                  }
                }}
                series={chartSeries}
                type="candlestick"
                height="100%"
              />
            )}
            
            {/* Bombastic YouTube-style price label at bottom of top half */}
            <div className="absolute bottom-0 left-0 right-0 flex justify-center items-center pb-2">
              <div className="relative">
                <div className="text-2xl font-bold text-white px-4 py-1 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg shadow-lg">
                  ${currentTickPrice ? currentTickPrice.toFixed(2) : (chartMetadata?.sortedData[0]?.open || 0).toFixed(2)}
                </div>
                <div className="absolute -inset-1 rounded-lg bg-white opacity-20 blur-sm"></div>
                <div className="absolute -inset-0.5 rounded-lg border-2 border-white"></div>
              </div>
            </div>
          </div>
          
          {/* Horizontal border between top and bottom half */}
          <div className="h-[2px] bg-gray-300 w-full shadow-sm"></div>
          
          {/* Bottom half of the iPhone can contain other content */}
          <div className="h-1/2 flex flex-col justify-between p-4 bg-gray-50">
            {/* Stock info section */}
            <div className="mb-4">
              <h3 className="text-lg font-bold mb-2">Stock Analysis</h3>
              <div className="text-sm text-gray-600 mb-1">Current Price</div>
              <div className="text-3xl font-bold text-blue-600">
                ${currentTickPrice ? currentTickPrice.toFixed(2) : (chartMetadata?.sortedData[0]?.open || 0).toFixed(2)}
              </div>
            </div>
            
            {/* Stats section */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white p-3 rounded-lg shadow-sm">
                <div className="text-xs text-gray-500">Volume</div>
                <div className="text-sm font-semibold">
                  {chartMetadata?.sortedData[0]?.volume ? 
                    formatVolume(chartMetadata.sortedData[0].volume) : 'N/A'}
                </div>
              </div>
              <div className="bg-white p-3 rounded-lg shadow-sm">
                <div className="text-xs text-gray-500">Change</div>
                <div className={`text-sm font-semibold ${
                  (chartMetadata?.sortedData[0]?.percentageChange || 0) >= 0 
                    ? 'text-green-600' 
                    : 'text-red-600'
                }`}>
                  {chartMetadata?.sortedData[0]?.percentageChange 
                    ? `${(chartMetadata.sortedData[0].percentageChange >= 0 ? '+' : '')}${chartMetadata.sortedData[0].percentageChange.toFixed(2)}%` 
                    : 'N/A'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </IPhoneMockup>
    </div>
  );
} 