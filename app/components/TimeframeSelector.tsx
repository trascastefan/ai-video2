import React from 'react';

export type Timeframe = '1w' | '1m' | '3m' | '1y' | '5y';

interface TimeframeSelectorProps {
  value: Timeframe;
  onChange: (timeframe: Timeframe) => void;
}

const timeframes: { label: string; value: Timeframe }[] = [
  { label: '1 Week', value: '1w' },
  { label: '1 Month', value: '1m' },
  { label: '3 Months', value: '3m' },
  { label: '1 Year', value: '1y' },
  { label: '5 Years', value: '5y' },
];

export default function TimeframeSelector({ value, onChange }: TimeframeSelectorProps) {
  return (
    <div className="flex gap-2">
      {timeframes.map((timeframe) => (
        <button
          key={timeframe.value}
          className={`px-4 py-2 rounded-lg transition-colors ${
            value === timeframe.value
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
          onClick={() => onChange(timeframe.value)}
        >
          {timeframe.label}
        </button>
      ))}
    </div>
  );
} 