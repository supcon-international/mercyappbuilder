import { useState, useCallback, useRef, useEffect } from 'react';
import { SessionList } from '@/components/SessionList';
import { ChatPanel } from '@/components/ChatPanel';
import { ViewPanel } from '@/components/ViewPanel';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/contexts/I18nContext';
import { api } from '@/lib/api';
import type { Session } from '@/types';

function App() {
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [selectedComponentContext, setSelectedComponentContext] = useState<string | null>(null);
  const [showView, setShowView] = useState(false);
  const [viewPanelTab, setViewPanelTab] = useState<'view' | 'uns' | 'flow'>('view');
  const [showSidebar, setShowSidebar] = useState(false);
  const { t, locale, toggleLocale } = useI18n();
  
  // Auto-show view ONLY when build is complete and running
  const [viewAutoShown, setViewAutoShown] = useState<string | null>(null);
  
  useEffect(() => {
    if (!selectedSession?.session_id) return;
    
    // Don't auto-show if already shown for this session or if view is already open
    if (showView || viewAutoShown === selectedSession.session_id) return;
    
    // Check view status periodically - only auto-show when RUNNING (build complete)
    const checkView = async () => {
      try {
        const status = await api.getViewStatus(selectedSession.session_id);
        // Only auto-show view if already running (user triggered build or previous session)
        // Do NOT auto-show for not_started - wait for user to manually start
        if (status.status === 'running') {
          setShowView(true);
          setViewPanelTab('view');
          setViewAutoShown(selectedSession.session_id);
        }
      } catch {
        // Ignore errors
      }
    };
    
    // Check immediately and then every 10 seconds (reduced frequency)
    checkView();
    const interval = setInterval(checkView, 10000);
    
    return () => clearInterval(interval);
  }, [selectedSession?.session_id, showView, viewAutoShown]);

  useEffect(() => {
    setSelectedComponentContext(null);
  }, [selectedSession?.session_id]);
  
  // Resizable panel state
  const [chatWidth, setChatWidth] = useState(50); // percentage
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const handleMouseDown = useCallback(() => {
    setIsResizing(true);
  }, []);
  
  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);
  
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing || !containerRef.current) return;
    
    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const sidebarWidth = 256; // approximate sidebar width
    const availableWidth = rect.width - sidebarWidth;
    const mouseX = e.clientX - rect.left - sidebarWidth;
    const percentage = (mouseX / availableWidth) * 100;
    
    // Clamp between 20% and 80%
    setChatWidth(Math.min(80, Math.max(20, percentage)));
  }, [isResizing]);
  
  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  return (
    <div className="h-screen bg-background flex flex-col antialiased relative overflow-hidden">
      {/* Background Glow Orbs - hidden on mobile for performance */}
      <div className="glow-orb glow-orb-1 hidden sm:block" aria-hidden="true" />
      <div className="glow-orb glow-orb-2 hidden sm:block" aria-hidden="true" />
      <div className="glow-orb glow-orb-3 hidden sm:block" aria-hidden="true" />

      {/* Header - Responsive */}
      <header className="relative z-20 border-b border-border/50 px-3 sm:px-6 py-2 sm:py-3 flex items-center justify-between bg-card/50 backdrop-blur-md">
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Mobile menu button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSidebar(!showSidebar)}
            className="sm:hidden h-8 w-8 p-0"
          >
            <span className="text-lg">{showSidebar ? '✕' : '☰'}</span>
          </Button>
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-primary flex items-center justify-center logo-pulse">
            <span className="text-primary-foreground font-bold text-xs sm:text-sm">T0</span>
          </div>
          <h1 className="text-sm sm:text-base font-semibold tracking-tight hidden xs:block">{t('appName')}</h1>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Language Toggle */}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleLocale}
            className="rounded-lg h-7 sm:h-8 px-2 sm:px-3 text-xs font-medium"
          >
            {locale === 'zh' ? 'EN' : '中'}
          </Button>
          {selectedSession && (
            <>
              <Button
                variant={showView && viewPanelTab === 'view' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  if (showView && viewPanelTab === 'view') {
                    setShowView(false);
                    return;
                  }
                  setViewPanelTab('view');
                  setShowView(true);
                }}
                className="rounded-lg h-7 sm:h-8 px-2 sm:px-3 text-xs font-medium btn-glow"
              >
                <span className="hidden sm:inline">{showView && viewPanelTab === 'view' ? t('hideView') : t('showView')}</span>
                <span className="sm:hidden">{showView && viewPanelTab === 'view' ? '✕' : '👁'}</span>
              </Button>
              <Button
                variant={showView && viewPanelTab === 'flow' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  if (showView && viewPanelTab === 'flow') {
                    setShowView(false);
                    return;
                  }
                  setViewPanelTab('flow');
                  setShowView(true);
                }}
                className="rounded-lg h-7 sm:h-8 px-2 sm:px-3 text-xs font-medium btn-glow"
              >
                <span className="hidden sm:inline">{showView && viewPanelTab === 'flow' ? t('hideFlow') : t('showFlow')}</span>
                <span className="sm:hidden">{showView && viewPanelTab === 'flow' ? '✕' : '🧩'}</span>
              </Button>
            </>
          )}
        </div>
      </header>

      {/* Main Content - Responsive */}
      <main ref={containerRef} className="relative z-10 flex-1 flex min-h-0 bg-muted/20 backdrop-blur-sm">
        {/* Session List Sidebar - Mobile overlay / Desktop fixed */}
        <aside className={`
          ${showSidebar ? 'translate-x-0' : '-translate-x-full'}
          sm:translate-x-0
          fixed sm:relative
          inset-y-0 left-0
          z-30 sm:z-auto
          w-64 sm:w-56 md:w-64 lg:w-72
          border-r border-border/50 
          bg-card/95 sm:bg-card/30 
          backdrop-blur-md sm:backdrop-blur-sm 
          flex-shrink-0
          transition-transform duration-300 ease-in-out
          pt-14 sm:pt-0
        `}>
          <SessionList
            selectedSession={selectedSession}
            onSelectSession={(session) => {
              setSelectedSession(session);
              setShowSidebar(false); // Close sidebar on mobile after selection
            }}
          />
        </aside>
        
        {/* Mobile overlay backdrop */}
        {showSidebar && (
          <div 
            className="fixed inset-0 bg-black/50 z-20 sm:hidden"
            onClick={() => setShowSidebar(false)}
          />
        )}

        {/* Chat Panel - Responsive & Resizable */}
        <section 
          className={`
            p-2 sm:p-4 min-w-0
            ${showView ? 'hidden md:block' : 'flex-1'}
          `}
          style={showView ? { width: `${chatWidth}%` } : undefined}
        >
          <ErrorBoundary>
            <ChatPanel
              session={selectedSession}
              selectedComponentContext={selectedComponentContext}
              onClearComponentContext={() => setSelectedComponentContext(null)}
            />
          </ErrorBoundary>
        </section>

        {/* Resize Handle */}
        {showView && (
          <div
            className="hidden md:flex w-1 hover:w-2 bg-border/50 hover:bg-primary/50 cursor-col-resize items-center justify-center transition-all group"
            onMouseDown={handleMouseDown}
          >
            <div className="w-0.5 h-8 bg-border group-hover:bg-primary rounded-full" />
          </div>
        )}

        {/* View Panel - Responsive & Resizable */}
        {showView && (
          <section 
            className="p-2 sm:p-4 min-w-0 hidden md:block"
            style={{ width: `${100 - chatWidth}%` }}
          >
            <ErrorBoundary>
              <ViewPanel
                sessionId={selectedSession?.session_id || null}
                onSelectComponentContext={setSelectedComponentContext}
                onClose={() => setShowView(false)}
                initialTab={viewPanelTab}
              />
            </ErrorBoundary>
          </section>
        )}
        
        {/* Mobile View (full width) */}
        {showView && (
          <section className="w-full p-2 sm:p-4 md:hidden">
            <ErrorBoundary>
              <ViewPanel
                sessionId={selectedSession?.session_id || null}
                onSelectComponentContext={setSelectedComponentContext}
                onClose={() => setShowView(false)}
                initialTab={viewPanelTab}
              />
            </ErrorBoundary>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
