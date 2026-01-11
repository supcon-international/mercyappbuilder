import { useState } from 'react';
import { SessionList } from '@/components/SessionList';
import { ChatPanel } from '@/components/ChatPanel';
import { PreviewPanel } from '@/components/PreviewPanel';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/contexts/I18nContext';
import type { Session } from '@/types';

function App() {
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const { t, locale, toggleLocale } = useI18n();

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
            <Button
              variant={showPreview ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowPreview(!showPreview)}
              className="rounded-lg h-7 sm:h-8 px-2 sm:px-3 text-xs font-medium btn-glow"
            >
              <span className="hidden sm:inline">{showPreview ? t('hidePreview') : t('showPreview')}</span>
              <span className="sm:hidden">{showPreview ? '✕' : '👁'}</span>
            </Button>
          )}
        </div>
      </header>

      {/* Main Content - Responsive */}
      <main className="relative z-10 flex-1 flex min-h-0 bg-muted/20 backdrop-blur-sm">
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

        {/* Chat Panel - Responsive */}
        <section className={`
          flex-1 p-2 sm:p-4 min-w-0
          ${showPreview ? 'hidden md:block md:w-1/2' : 'w-full'}
        `}>
          <ChatPanel session={selectedSession} />
        </section>

        {/* Preview Panel - Responsive */}
        {showPreview && (
          <section className={`
            w-full md:w-1/2 
            p-2 sm:p-4 
            border-l border-border/50
            ${showPreview ? 'block' : 'hidden'}
          `}>
            <PreviewPanel
              sessionId={selectedSession?.session_id || null}
              onClose={() => setShowPreview(false)}
            />
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
