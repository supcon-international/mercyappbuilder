import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { useI18n } from '@/contexts/I18nContext';
import type { PreviewStatus } from '@/lib/api';

// SVG Icons
const PlayIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M8 5v14l11-7z"/>
  </svg>
);

const RefreshIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
    <path d="M3 3v5h5"/>
    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
    <path d="M16 16h5v5"/>
  </svg>
);

const ExternalLinkIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/>
    <line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
);

const StopIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <rect x="6" y="6" width="12" height="12" rx="1"/>
  </svg>
);

const CloseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

const MonitorIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
    <line x1="8" y1="21" x2="16" y2="21"/>
    <line x1="12" y1="17" x2="12" y2="21"/>
  </svg>
);

const LoaderIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
  </svg>
);

interface PreviewPanelProps {
  sessionId: string | null;
  onClose: () => void;
}

export function PreviewPanel({ sessionId, onClose }: PreviewPanelProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<PreviewStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!sessionId) return;
    try {
      const result = await api.getPreviewStatus(sessionId);
      setStatus(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get status');
    }
  }, [sessionId]);

  useEffect(() => {
    fetchStatus();
    // Poll status while starting
    const interval = setInterval(() => {
      if (status?.status === 'starting') {
        fetchStatus();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [sessionId, fetchStatus, status?.status]);

  const handleStart = async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.startPreview(sessionId);
      setStatus(result);
      
      // If starting, poll for updates
      if (result.status === 'starting') {
        const checkInterval = setInterval(async () => {
          const updated = await api.getPreviewStatus(sessionId);
          setStatus(updated);
          if (updated.status !== 'starting') {
            clearInterval(checkInterval);
          }
        }, 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start preview');
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      await api.stopPreview(sessionId);
      setStatus(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop preview');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement;
    if (iframe && status?.url) {
      iframe.src = status.url;
    }
  };

  if (!sessionId) {
    return (
      <Card className="h-full flex items-center justify-center border-border/50 shadow-sm card-hover">
        <div className="text-center text-muted-foreground">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-accent/50 flex items-center justify-center transition-transform duration-300 hover:scale-110">
            <MonitorIcon />
          </div>
          <p className="font-medium">{t('selectSessionPreview')}</p>
        </div>
      </Card>
    );
  }

  const isRunning = status?.status === 'running';
  const isStarting = status?.status === 'starting';

  return (
    <Card className="h-full flex flex-col gap-0 py-0 overflow-hidden border-border/50 shadow-sm card-hover">
      <CardHeader className="py-2 sm:py-2.5 px-2 sm:px-3 flex-shrink-0 border-b border-border/30">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 flex-1">
            <CardTitle className="text-xs sm:text-sm font-medium">{t('preview')}</CardTitle>
            {status && (
              <Badge
                variant={isRunning ? 'default' : isStarting ? 'secondary' : 'outline'}
                className="text-xs rounded-lg font-normal h-5 px-1.5 sm:px-2"
              >
                {status.status === 'running' && t('running')}
                {status.status === 'starting' && t('starting')}
                {status.status === 'stopped' && t('stopped')}
                {status.status === 'error' && t('error')}
                {status.status === 'not_started' && t('notStarted')}
              </Badge>
            )}
            {status?.port && (
              <span className="text-xs text-muted-foreground font-mono hidden sm:inline">
                :{status.port}
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
            {isRunning && (
              <>
                <Button variant="ghost" size="sm" onClick={handleRefresh} className="h-6 w-6 sm:h-7 sm:w-7 p-0 rounded-lg" title="Refresh">
                  <RefreshIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(status?.url || '', '_blank')}
                  className="h-6 w-6 sm:h-7 sm:w-7 p-0 rounded-lg"
                  title="Open in new window"
                >
                  <ExternalLinkIcon />
                </Button>
              </>
            )}
            {(isRunning || isStarting) && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleStop}
                disabled={loading}
                className="h-6 sm:h-7 rounded-lg px-1.5 sm:px-2.5 text-xs btn-glow flex items-center gap-0.5 sm:gap-1"
              >
                <StopIcon />
                <span className="hidden sm:inline">{t('stop')}</span>
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onClose} className="h-6 w-6 sm:h-7 sm:w-7 p-0 rounded-lg transition-transform duration-200 hover:scale-110 hover:rotate-90">
              <CloseIcon />
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 p-0 overflow-hidden bg-muted/20">
        {error && (
          <div className="m-4 p-4 bg-destructive/10 text-destructive text-sm rounded-xl">
            {error}
          </div>
        )}
        
        {status?.error && (
          <div className="m-4 p-4 bg-destructive/10 text-destructive text-sm rounded-xl">
            {status.error}
          </div>
        )}
        
        {isStarting && (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                <LoaderIcon />
              </div>
              <p className="font-medium">{t('starting')}</p>
              <p className="text-xs mt-1 opacity-70">{t('installingDeps')}</p>
            </div>
          </div>
        )}
        
        {isRunning && status?.url && (
          <iframe
            id="preview-iframe"
            src={status.url}
            className="w-full h-full border-0 bg-white"
            title="Preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        )}
        
        {!isRunning && !isStarting && !error && !status?.error && (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-5 rounded-2xl bg-accent/50 flex items-center justify-center">
                <MonitorIcon />
              </div>
              <p className="font-medium mb-1">{t('previewProject')}</p>
              <p className="text-xs mb-5 opacity-70 max-w-[200px] mx-auto">
                {t('previewHint')}
              </p>
              <Button
                variant="default"
                size="lg"
                onClick={handleStart}
                disabled={loading}
                className="rounded-xl px-8 py-3 h-12 text-sm font-medium btn-glow flex items-center gap-2 mx-auto"
              >
                <PlayIcon />
                {loading ? t('starting') : t('start')}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
