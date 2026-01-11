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
  const { t, locale, toggleLocale } = useI18n();

  return (
    <div className="h-screen bg-background flex flex-col antialiased relative overflow-hidden">
      {/* Background Glow Orbs */}
      <div className="glow-orb glow-orb-1" aria-hidden="true" />
      <div className="glow-orb glow-orb-2" aria-hidden="true" />
      <div className="glow-orb glow-orb-3" aria-hidden="true" />

      {/* Header - Clean minimal design */}
      <header className="relative z-10 border-b border-border/50 px-6 py-3 flex items-center justify-between bg-card/50 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center logo-pulse">
            <span className="text-primary-foreground font-bold text-sm">T0</span>
          </div>
          <h1 className="text-base font-semibold tracking-tight">{t('appName')}</h1>
        </div>
        <div className="flex items-center gap-2">
          {/* Language Toggle */}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleLocale}
            className="rounded-lg h-8 px-3 text-xs font-medium"
          >
            {locale === 'zh' ? 'EN' : '中'}
          </Button>
          {selectedSession && (
            <Button
              variant={showPreview ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowPreview(!showPreview)}
              className="rounded-lg h-8 px-3 text-xs font-medium btn-glow"
            >
              {showPreview ? t('hidePreview') : t('showPreview')}
            </Button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex min-h-0 bg-muted/20 backdrop-blur-sm">
        {/* Session List Sidebar */}
        <aside className="w-72 border-r border-border/50 bg-card/30 backdrop-blur-sm flex-shrink-0">
          <SessionList
            selectedSession={selectedSession}
            onSelectSession={setSelectedSession}
          />
        </aside>

        {/* Chat Panel */}
        <section className={`p-4 ${showPreview ? 'w-1/2' : 'flex-1'}`}>
          <ChatPanel session={selectedSession} />
        </section>

        {/* Preview Panel */}
        {showPreview && (
          <section className="w-1/2 p-4 border-l border-border/50">
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
