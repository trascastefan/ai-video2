'use client';

import React, { useState } from 'react';
import StockChart from './StockChart';
import { TimeSeriesData, SignificantMove } from './VolumeAnalysis';

interface ChartWithControlsProps {
  timeSeriesData: TimeSeriesData[];
  significantMoves: SignificantMove[];
}

export default function ChartWithControls({ 
  timeSeriesData, 
  significantMoves 
}: ChartWithControlsProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(100);

  return (
    <>
      {/* Display the StockChart with iPhone mockup */}
      <StockChart
        data={timeSeriesData}
        significantMoves={significantMoves}
        isPlaying={isPlaying}
        playbackSpeed={playbackSpeed}
        onAnimationComplete={() => setIsPlaying(false)}
      />
      
      {/* Play controls */}
      <div className="flex items-center gap-4 justify-center mt-4">
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <div className="flex items-center gap-2">
          <label htmlFor="speed" className="text-sm text-gray-600">Speed:</label>
          <select
            id="speed"
            value={playbackSpeed}
            onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
            className="rounded-lg border border-gray-300 px-2 py-1"
          >
            <option value="200">Slow</option>
            <option value="100">Normal</option>
            <option value="50">Fast</option>
          </select>
        </div>
      </div>
    </>
  );
}
