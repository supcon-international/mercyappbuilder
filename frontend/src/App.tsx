import { useState, useCallback, useRef, useEffect } from 'react';
import { SessionList } from '@/components/SessionList';
import { ChatPanel } from '@/components/ChatPanel';
import { ViewPanel } from '@/components/ViewPanel';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/contexts/I18nContext';
import { useSessions } from '@/hooks/useSession';
import { api } from '@/lib/api';
import type { Session } from '@/types';

function App() {
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [selectedComponentContext, setSelectedComponentContext] = useState<string | null>(null);
  const [showView, setShowView] = useState(false);
  const [viewPanelTab, setViewPanelTab] = useState<'preview' | 'production' | 'uns' | 'flow'>('preview');
  const [showSidebar, setShowSidebar] = useState(false); // Mobile sidebar
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false); // Desktop sidebar collapse
  const [isCreateSessionOpen, setIsCreateSessionOpen] = useState(false);
  const { t } = useI18n();
  const { sessions } = useSessions();
  
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
          setViewPanelTab('preview');
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

      {/* Main Content - Responsive */}
      <main ref={containerRef} className="relative z-10 flex-1 flex min-h-0 bg-muted/20 backdrop-blur-sm">
        {/* Mobile sidebar toggle */}
        {!showSidebar && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSidebar(true)}
            className="sm:hidden fixed top-3 left-3 z-30 h-9 w-9 p-0 rounded-lg bg-card/80 border border-border/50 shadow-md"
          >
            <span className="text-lg">☰</span>
          </Button>
        )}
        {/* Session List Sidebar - Mobile overlay / Desktop collapsible */}
        <aside className={`
          ${showSidebar ? 'translate-x-0' : '-translate-x-full'}
          sm:translate-x-0
          fixed sm:relative
          inset-y-0 left-0
          z-30 sm:z-auto
          ${sidebarCollapsed ? 'sm:w-12' : 'w-64 sm:w-56 md:w-64 lg:w-72'}
          border-r border-border/60
          bg-card/95 sm:bg-card/70
          backdrop-blur-xl sm:backdrop-blur-xl
          shadow-lg z-20 
          flex-shrink-0
          transition-all duration-300 ease-in-out
          pt-14 sm:pt-0
          overflow-hidden
        `}>
          {/* Collapse toggle button - Desktop only */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="hidden sm:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10 w-5 h-10 items-center justify-center bg-card border border-border/50 rounded-full shadow-sm hover:bg-accent transition-colors"
            title={sidebarCollapsed ? t('expandSidebar') : t('collapseSidebar')}
          >
            <span className={`text-xs text-muted-foreground transition-transform ${sidebarCollapsed ? 'rotate-180' : ''}`}>
              ‹
            </span>
          </button>
          
          {/* Collapsed state - show only icons */}
          {sidebarCollapsed ? (
            <div className="hidden sm:flex flex-col items-center py-4 gap-2">
              <Button
                size="sm"
                className="w-8 h-8 p-0 rounded-lg btn-glow"
                onClick={() => setSidebarCollapsed(false)}
                title={t('newSession')}
              >
                +
              </Button>
              {sessions.slice(0, 5).map((session) => (
                <button
                  key={session.session_id}
                  onClick={() => {
                    setSelectedSession(session);
                    setSidebarCollapsed(false);
                  }}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-medium transition-colors ${
                    selectedSession?.session_id === session.session_id
                      ? 'bg-primary/15 border border-primary/30'
                      : 'hover:bg-accent/50'
                  }`}
                  title={session.display_name || session.session_id.slice(0, 8)}
                >
                  {(session.display_name || session.session_id)[0].toUpperCase()}
                </button>
              ))}
            </div>
          ) : (
            <SessionList
              selectedSession={selectedSession}
              onSelectSession={(session) => {
                setSelectedSession(session);
                setShowSidebar(false); // Close sidebar on mobile after selection
              }}
              isCreateOpen={isCreateSessionOpen}
              onOpenCreateChange={setIsCreateSessionOpen}
            />
          )}
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
              onCreateSession={() => setIsCreateSessionOpen(true)}
              showView={showView}
              viewPanelTab={viewPanelTab}
              onToggleView={() => {
                if (showView && viewPanelTab === 'preview') {
                  setShowView(false);
                  return;
                }
                setViewPanelTab('preview');
                setShowView(true);
              }}
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
