import React, { ReactNode } from 'react';

interface IPhoneMockupProps {
  children: ReactNode;
}

export default function IPhoneMockup({ children }: IPhoneMockupProps) {
  return (
    <div className="flex justify-center items-center">
      <div className="relative w-[320px] h-[650px] bg-black rounded-[50px] border-[14px] border-black shadow-xl overflow-hidden">
        {/* iPhone notch */}
        <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-[150px] h-[30px] bg-black rounded-b-[14px] z-10"></div>
        
        {/* iPhone screen */}
        <div className="relative w-full h-full bg-white overflow-hidden rounded-[36px] flex flex-col">
          {/* Status bar */}
          <div className="h-[40px] bg-black text-white flex justify-between items-center px-6 text-xs">
            <div>9:41</div>
            <div className="flex space-x-2">
              <span>5G</span>
              <span>100%</span>
            </div>
          </div>
          
          {/* Content area */}
          <div className="flex-1 overflow-hidden">
            {children}
          </div>
          
          {/* Home indicator */}
          <div className="h-[5px] flex justify-center items-center pb-1">
            <div className="w-[134px] h-[5px] bg-gray-400 rounded-full"></div>
          </div>
        </div>
      </div>
    </div>
  );
}
