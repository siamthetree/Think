import React, { useState, useEffect } from 'react';
import { Wifi, Battery, Smartphone, Maximize2, CloudOff, Cloud, RefreshCw, Download, Monitor } from 'lucide-react';

interface IPhoneFrameProps {
  children: React.ReactNode;
  isOffline: boolean;
  onToggleOffline: () => void;
  onRefreshAll: () => void;
  isRefreshing: boolean;
  onOpenIosModal?: () => void;
}

export const IPhoneFrame: React.FC<IPhoneFrameProps> = ({
  children,
  isOffline,
  onToggleOffline,
  onRefreshAll,
  isRefreshing,
  onOpenIosModal,
}) => {
  const [currentTime, setCurrentTime] = useState('9:41');
  const [frameMode, setFrameMode] = useState<'adaptive' | 'iphone13'>('adaptive');
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  // Detect if running on mobile device, iPhone, or narrow viewport
  useEffect(() => {
    const checkViewport = () => {
      const isMobile =
        window.innerWidth <= 768 ||
        window.location.protocol === 'capacitor:' ||
        window.location.protocol === 'ionic:' ||
        /iPhone|iPod|iPad|Android|Mobile/i.test(navigator.userAgent);
      setIsMobileViewport(isMobile);
    };

    checkViewport();
    window.addEventListener('resize', checkViewport);
    return () => window.removeEventListener('resize', checkViewport);
  }, []);

  // Update real-time clock for status bar
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes().toString().padStart(2, '0');
      setCurrentTime(`${hours}:${minutes}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 30000);
    return () => clearInterval(interval);
  }, []);

  // Real Mobile / Native iPhone: Edge-to-edge full screen experience
  if (isMobileViewport) {
    return (
      <div className="native-app-shell w-full h-[100dvh] min-h-[100dvh] flex flex-col overflow-hidden bg-white dark:bg-[#090A0C] text-stone-900 dark:text-stone-100 select-none">
        {children}
      </div>
    );
  }

  // Desktop / Tablet Viewport
  return (
    <div className="w-full h-[100dvh] bg-stone-100 dark:bg-stone-950 text-stone-900 dark:text-stone-100 flex flex-col items-center justify-start overflow-hidden transition-colors duration-200">
      {/* Top Desktop Navigation & Controls Bar */}
      <header className="shrink-0 w-full bg-white/95 dark:bg-stone-900/95 backdrop-blur-md border-b border-stone-200/80 dark:border-stone-800/80 z-30 px-4 py-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="font-serif font-bold tracking-tight text-base text-stone-950 dark:text-stone-50">
              PaperPress
            </span>
            <span className="text-xs text-stone-400 dark:text-stone-500 font-sans">
              Inoreader Feed
            </span>
          </div>
          <span className="hidden sm:inline-block text-xs text-stone-300 dark:text-stone-700">|</span>
          <span className="hidden sm:inline-block text-xs text-stone-500 dark:text-stone-400 font-sans">
            Minimalist & Distraction-Free
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* iOS IPA Builder Modal Trigger */}
          {onOpenIosModal && (
            <button
              onClick={onOpenIosModal}
              data-testid="open-ios-ipa-modal"
              aria-label="Export to GitHub and build iOS IPA"
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-stone-200/80 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-300 dark:hover:bg-stone-700 flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-stone-600 dark:text-stone-400" />
              <span className="hidden sm:inline">iOS .ipa</span>
            </button>
          )}

          {/* Offline Mode Toggle */}
          <button
            onClick={onToggleOffline}
            aria-label={isOffline ? 'Switch to Online mode' : 'Simulate Offline mode'}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
              isOffline
                ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-800'
                : 'bg-stone-200/80 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-300 dark:hover:bg-stone-700'
            }`}
          >
            {isOffline ? <CloudOff className="w-3.5 h-3.5 text-amber-600" /> : <Cloud className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
            <span className="hidden sm:inline">{isOffline ? 'Offline' : 'Online'}</span>
          </button>

          {/* Sync / Refresh Button */}
          <button
            onClick={onRefreshAll}
            disabled={isRefreshing || isOffline}
            aria-label="Refresh feeds"
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-stone-200/80 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-300 dark:hover:bg-stone-700 disabled:opacity-40 flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-600 dark:text-emerald-400' : ''}`} />
            <span className="hidden sm:inline">{isRefreshing ? 'Syncing...' : 'Sync'}</span>
          </button>

          {/* Layout Mode Switcher: Adaptive Full Screen vs iPhone 13 Canvas */}
          <div className="flex items-center bg-stone-200/80 dark:bg-stone-800/90 p-0.5 rounded-lg border border-stone-300/60 dark:border-stone-700/60">
            <button
              onClick={() => setFrameMode('adaptive')}
              aria-label="Adaptive Full Screen Experience"
              className={`px-2.5 py-1 text-xs font-medium rounded-md flex items-center gap-1.5 transition-all ${
                frameMode === 'adaptive'
                  ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-100 shadow-xs'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200'
              }`}
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Full View</span>
            </button>
            <button
              onClick={() => setFrameMode('iphone13')}
              aria-label="iPhone 13 Canvas Preview"
              className={`px-2.5 py-1 text-xs font-medium rounded-md flex items-center gap-1.5 transition-all ${
                frameMode === 'iphone13'
                  ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-100 shadow-xs'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>iPhone 13</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Reading Canvas */}
      <main className="flex-1 w-full overflow-hidden flex items-center justify-center relative">
        {frameMode === 'adaptive' ? (
          /* ADAPTIVE FULL-SCREEN EXPERIENCE */
          <div className="w-full max-w-4xl h-full flex flex-col bg-white dark:bg-[#090A0C] shadow-2xl md:border-x border-stone-200/80 dark:border-stone-800/80 overflow-hidden relative">
            {children}
          </div>
        ) : (
          /* IPHONE 13 CALIBRATED FRAME */
          <div className="relative my-auto select-none py-4">
            {/* Aluminum Outer Chassis */}
            <div className="p-[11px] rounded-[56px] bg-gradient-to-b from-stone-800 via-stone-850 to-stone-900 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8),0_0_0_1px_rgba(255,255,255,0.08)] ring-1 ring-black">
              {/* iPhone 13 Screen (390 × 844 px) */}
              <div
                data-testid="iphone-13-screen"
                className="w-[390px] h-[844px] rounded-[46px] bg-white dark:bg-[#090A0C] text-stone-900 dark:text-stone-100 relative flex flex-col overflow-hidden shadow-inner"
              >
                {/* iPhone 13 Top Status Bar with Notch */}
                <div className="absolute top-0 left-0 h-[47px] w-full flex items-center justify-between px-7 select-none bg-transparent z-30 border-b border-stone-200/20 dark:border-stone-800/20 backdrop-blur-xl pointer-events-none">
                  <span className="text-[14px] font-semibold tracking-tight text-stone-900 dark:text-stone-100 font-sans pl-1">
                    {currentTime}
                  </span>

                  {/* Notch */}
                  <div
                    data-testid="iphone-13-notch"
                    className="absolute top-0 left-1/2 -translate-x-1/2 w-[154px] h-[28px] bg-black rounded-b-[18px] flex items-center justify-between px-3.5 z-40 shadow-sm"
                    aria-hidden="true"
                  >
                    <div className="absolute top-[2px] left-1/2 -translate-x-1/2 w-[44px] h-[3px] bg-stone-900 rounded-full" />
                    <div className="w-[9px] h-[9px] rounded-full bg-[#0d131f] ring-1 ring-stone-800/80 flex items-center justify-center mt-0.5">
                      <div className="w-[3px] h-[3px] rounded-full bg-blue-950/80" />
                    </div>
                    <div className="w-[5px] h-[5px] rounded-full bg-stone-950 mt-0.5" />
                  </div>

                  {/* Status Icons */}
                  <div className="flex items-center gap-1.5 text-stone-900 dark:text-stone-100 pr-1">
                    <div className="flex items-end gap-[1.5px] h-3 mr-0.5" aria-label="Cellular Signal">
                      <div className="w-[3px] h-[4px] bg-current rounded-[0.5px]" />
                      <div className="w-[3px] h-[6px] bg-current rounded-[0.5px]" />
                      <div className="w-[3px] h-[8px] bg-current rounded-[0.5px]" />
                      <div className="w-[3px] h-[11px] bg-current rounded-[0.5px]" />
                    </div>
                    <Wifi className="w-3.5 h-3.5 stroke-[2.2]" />
                    <div className="flex items-center" aria-label="Battery 100%">
                      <div className="w-[20px] h-[10px] rounded-[3px] border border-current p-[1px] flex items-center">
                        <div className="w-full h-full bg-current rounded-[1px]" />
                      </div>
                      <div className="w-[1.5px] h-[3.5px] bg-current rounded-r-[1px] ml-[1px]" />
                    </div>
                  </div>
                </div>

                {/* Screen Content */}
                <div className="flex-1 overflow-hidden flex flex-col relative w-full">
                  {children}
                </div>

                {/* iPhone Home Indicator */}
                <div className="shrink-0 h-[30px] w-full flex items-center justify-center pb-2 bg-stone-50 dark:bg-[#090A0C] select-none z-30">
                  <div className="w-[130px] h-[4.5px] bg-stone-400 dark:bg-stone-600 rounded-full" />
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
