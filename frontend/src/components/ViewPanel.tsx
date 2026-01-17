import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { useI18n } from '@/contexts/I18nContext';
import type { ViewStatus, FlowStatus } from '@/lib/api';
import type { UnsData, UnsTopic } from '@/types';

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

interface ViewPanelProps {
  sessionId: string | null;
  onSelectComponentContext: (context: string | null) => void;
  onClose: () => void;
  initialTab?: 'view' | 'uns' | 'flow';
}

export function ViewPanel({ sessionId, onSelectComponentContext, onClose, initialTab }: ViewPanelProps) {
  const { t } = useI18n();
  const tText = t as (key: string) => string;
  const [status, setStatus] = useState<ViewStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'view' | 'uns' | 'flow'>(initialTab ?? 'view');
  const [unsLoading, setUnsLoading] = useState(false);
  const [unsError, setUnsError] = useState<string | null>(null);
  const [unsData, setUnsData] = useState<UnsData | null>(null);
  const [unsSelectedPath, setUnsSelectedPath] = useState<string | null>(null);
  const [unsExpanded, setUnsExpanded] = useState<Set<string>>(new Set());
  const [flowStatus, setFlowStatus] = useState<FlowStatus | null>(null);
  const [flowLoading, setFlowLoading] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const flowIframeRef = useRef<HTMLIFrameElement | null>(null);
  const highlightRef = useRef<{ element: HTMLElement; outline: string; outlineOffset: string } | null>(null);
  const hoverRef = useRef<{ element: HTMLElement; outline: string; outlineOffset: string } | null>(null);
  const editModeRef = useRef(false);
  const initialTabRef = useRef<ViewPanelProps['initialTab']>(initialTab);

  const fetchStatus = useCallback(async () => {
    if (!sessionId) return;
    try {
      const result = await api.getViewStatus(sessionId);
      setStatus(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get status');
    }
  }, [sessionId]);

  const fetchUns = useCallback(async () => {
    if (!sessionId) return;
    setUnsLoading(true);
    setUnsError(null);
    try {
      const result = await api.getUns(sessionId);
      setUnsData(result);
      setUnsSelectedPath(result.topics?.[0]?.path || null);
      const expandedPaths = new Set<string>();
      (result.topics || []).forEach((topic) => {
        const segments = topic.path.split('/').filter(Boolean);
        let currentPath = '';
        segments.forEach((segment, index) => {
          currentPath = currentPath ? `${currentPath}/${segment}` : segment;
          if (index < segments.length - 1) {
            expandedPaths.add(currentPath);
          }
        });
      });
      setUnsExpanded(expandedPaths);
    } catch (err) {
      setUnsError(err instanceof Error ? err.message : 'Failed to load UNS');
      setUnsData(null);
    } finally {
      setUnsLoading(false);
    }
  }, [sessionId]);

  const startFlow = useCallback(async () => {
    setFlowLoading(true);
    setFlowError(null);
    try {
      const result = await api.startFlow();
      setFlowStatus(result);
    } catch (err) {
      setFlowError(err instanceof Error ? err.message : 'Failed to start flow');
    } finally {
      setFlowLoading(false);
    }
  }, []);

  // No auto-start - user must click Build button manually
  // This prevents starting view before project is fully generated
  
  useEffect(() => {
    fetchStatus();
    // Poll status while building
    const interval = setInterval(() => {
      if (status?.status === 'building') {
        fetchStatus();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [sessionId, fetchStatus, status?.status]);

  useEffect(() => {
    if (activeTab === 'uns') {
      fetchUns();
    }
  }, [activeTab, fetchUns]);

  useEffect(() => {
    if (activeTab === 'flow') {
      startFlow();
    }
  }, [activeTab, startFlow]);

  useEffect(() => {
    if (initialTab && initialTab !== initialTabRef.current) {
      initialTabRef.current = initialTab;
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  const handleStart = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.startView(sessionId);
      setStatus(result);
      
      // If building, poll for updates
      if (result.status === 'building') {
        const checkInterval = setInterval(async () => {
          const updated = await api.getViewStatus(sessionId);
          setStatus(updated);
          if (updated.status !== 'building') {
            clearInterval(checkInterval);
          }
        }, 2000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start view');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);
  
  const handleStop = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      await api.stopView(sessionId);
      setStatus(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop view');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    const iframe = iframeRef.current;
    if (iframe && status?.url) {
      iframe.src = status.url;
    }
  };

  const handleFlowRefresh = () => {
    const iframe = flowIframeRef.current;
    if (iframe && flowStatus?.url) {
      const flowUrl = sessionId ? `${flowStatus.url}#flow/${sessionId}` : flowStatus.url;
      iframe.src = flowUrl;
    }
  };

  const buildSelector = (element: Element) => {
    if (element.id) return `#${element.id}`;
    const path: string[] = [];
    let current: Element | null = element;
    while (current && current.nodeType === 1 && current.tagName.toLowerCase() !== 'html') {
      const currentEl: Element = current as Element;
      const tag = currentEl.tagName.toLowerCase();
      const parentEl: Element | null = currentEl.parentElement;
      if (!parentEl) {
        path.unshift(tag);
        break;
      }
      const siblings = Array.from(parentEl.children) as Element[];
      const sameTagSiblings = siblings.filter((child) => child.tagName === currentEl.tagName);
      const index = sameTagSiblings.indexOf(currentEl) + 1;
      path.unshift(`${tag}:nth-of-type(${index})`);
      if (parentEl.tagName.toLowerCase() === 'body') break;
      current = parentEl;
    }
    return path.join(' > ');
  };

  const buildContext = (element: HTMLElement) => {
    const componentName = (() => {
      const tag = element.tagName.toLowerCase();
      if (element.id) {
        return `${tag}#${element.id}`;
      }
      const className = typeof element.className === 'string' ? element.className.trim() : '';
      if (className) {
        return `${tag}.${className.split(/\s+/)[0]}`;
      }
      const aria = element.getAttribute('aria-label');
      if (aria) {
        return `${tag}(${aria})`;
      }
      return tag;
    })();
    const text = (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ');
    const attrs = [
      element.getAttribute('role'),
      element.getAttribute('aria-label'),
      element.getAttribute('name'),
      element.getAttribute('data-testid'),
    ].filter(Boolean);
    const rect = element.getBoundingClientRect();
    return [
      `component: ${componentName}`,
      `tag: ${element.tagName.toLowerCase()}`,
      element.id ? `id: ${element.id}` : null,
      element.className ? `class: ${element.className}` : null,
      text ? `text: ${text.slice(0, 160)}` : null,
      attrs.length > 0 ? `attrs: ${attrs.join(' | ')}` : null,
      `selector: ${buildSelector(element)}`,
      `bounds: x=${Math.round(rect.x)}, y=${Math.round(rect.y)}, w=${Math.round(rect.width)}, h=${Math.round(rect.height)}`,
    ].filter(Boolean).join('\n');
  };

  const clearHighlight = useCallback(() => {
    if (highlightRef.current) {
      const { element, outline, outlineOffset } = highlightRef.current;
      element.style.outline = outline;
      element.style.outlineOffset = outlineOffset;
      highlightRef.current = null;
    }
  }, []);

  const clearHoverHighlight = useCallback(() => {
    if (hoverRef.current) {
      const { element, outline, outlineOffset } = hoverRef.current;
      element.style.outline = outline;
      element.style.outlineOffset = outlineOffset;
      hoverRef.current = null;
    }
  }, []);

  const exitEditMode = useCallback(() => {
    setEditMode(false);
    clearHighlight();
    clearHoverHighlight();
    onSelectComponentContext(null);
  }, [clearHighlight, clearHoverHighlight, onSelectComponentContext]);

  const handleIframeClick = useCallback((event: MouseEvent) => {
    if (!editModeRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const rawTarget = event.target as Node | null;
    const target = rawTarget instanceof HTMLElement ? rawTarget : rawTarget?.parentElement;
    if (!target) return;
    clearHighlight();
    highlightRef.current = {
      element: target,
      outline: target.style.outline || '',
      outlineOffset: target.style.outlineOffset || '',
    };
    target.style.outline = '2px solid #B2ED1D';
    target.style.outlineOffset = '2px';
    onSelectComponentContext(buildContext(target));
  }, [clearHighlight, onSelectComponentContext]);

  const handleIframeHover = useCallback((event: MouseEvent) => {
    if (!editModeRef.current) return;
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const target = doc.elementFromPoint(event.clientX, event.clientY);
    const element = target instanceof HTMLElement ? target : target?.parentElement;
    if (!element) return;
    if (highlightRef.current?.element === element) return;
    if (hoverRef.current?.element === element) return;
    clearHoverHighlight();
    hoverRef.current = {
      element,
      outline: element.style.outline || '',
      outlineOffset: element.style.outlineOffset || '',
    };
    element.style.outline = '1px dashed #B2ED1D';
    element.style.outlineOffset = '1px';
  }, [clearHoverHighlight]);

  const attachIframeListeners = useCallback(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc) return;
    doc.removeEventListener('click', handleIframeClick, true);
    doc.removeEventListener('mousemove', handleIframeHover, true);
    doc.addEventListener('click', handleIframeClick, true);
    doc.addEventListener('mousemove', handleIframeHover, true);
  }, [handleIframeClick, handleIframeHover]);

  useEffect(() => {
    editModeRef.current = editMode;
    attachIframeListeners();
    if (!editMode) {
      clearHighlight();
      clearHoverHighlight();
      onSelectComponentContext(null);
    }
  }, [editMode, attachIframeListeners, clearHighlight, clearHoverHighlight, onSelectComponentContext]);

  useEffect(() => {
    if (!editMode) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        exitEditMode();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editMode, exitEditMode]);

  if (!sessionId) {
    return (
      <Card className="h-full flex items-center justify-center border-border/50 shadow-sm card-hover">
        <div className="text-center text-muted-foreground">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-accent/50 flex items-center justify-center transition-transform duration-300 hover:scale-110">
            <MonitorIcon />
          </div>
          <p className="font-medium">{t('selectSessionView')}</p>
        </div>
      </Card>
    );
  }

  const isRunning = status?.status === 'running';
  const isBuilding = status?.status === 'building';
  const isFlowRunning = flowStatus?.status === 'running';
  const isFlowStarting = flowStatus?.status === 'starting';
  const activeStatus = activeTab === 'flow' ? flowStatus : status;

  const unsTopics = unsData?.topics || [];
  const unsByPath = unsTopics.reduce<Record<string, UnsTopic>>((acc, topic) => {
    acc[topic.path] = topic;
    return acc;
  }, {});

  type UnsTreeNode = {
    name: string;
    path: string;
    children: UnsTreeNode[];
    topic?: UnsTopic;
  };

  const buildUnsTree = (topics: UnsTopic[]) => {
    const root: UnsTreeNode = { name: 'root', path: '', children: [] };
    for (const topic of topics) {
      const segments = topic.path.split('/').filter(Boolean);
      let current = root;
      let currentPath = '';
      segments.forEach((segment, index) => {
        currentPath = currentPath ? `${currentPath}/${segment}` : segment;
        let child = current.children.find((node) => node.name === segment);
        if (!child) {
          child = { name: segment, path: currentPath, children: [] };
          current.children.push(child);
        }
        if (index === segments.length - 1) {
          child.topic = topic;
        }
        current = child;
      });
    }
    return root;
  };

  const unsTree = buildUnsTree(unsTopics);
  const selectedTopic = unsSelectedPath ? unsByPath[unsSelectedPath] : null;
  const unsMeta = unsData?.site
    ? `${unsData.site}${unsData.version ? ` · ${unsData.version}` : ''}`
    : unsData?.version;
  const countUnsNodes = (node: UnsTreeNode): number =>
    1 + node.children.reduce((sum, child) => sum + countUnsNodes(child), 0);
  const unsNodeCount = unsTree.children.reduce((sum, node) => sum + countUnsNodes(node), 0);
  const selectedPathSegments = selectedTopic?.path.split('/').filter(Boolean) ?? [];
  const toggleUnsNode = (path: string) => {
    setUnsExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  useEffect(() => {
    if (!isRunning) {
      setEditMode(false);
      clearHighlight();
      clearHoverHighlight();
      onSelectComponentContext(null);
    }
  }, [isRunning, clearHighlight, clearHoverHighlight, onSelectComponentContext]);

  return (
    <Card className="h-full flex flex-col gap-0 py-0 overflow-hidden border-border/50 shadow-sm card-hover">
      <CardHeader className="py-2 sm:py-2.5 px-2 sm:px-3 flex-shrink-0 border-b border-border/30">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 flex-1">
            <CardTitle className="text-xs sm:text-sm font-medium">
              {activeTab === 'flow' ? t('flow') : t('view')}
            </CardTitle>
            <div className="ml-2 flex items-center gap-1 bg-muted/40 rounded-lg p-0.5">
              <Button
                variant={activeTab === 'view' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('view')}
                className="h-6 px-2 text-[11px] rounded-md"
              >
                {tText('viewTab')}
              </Button>
              <Button
                variant={activeTab === 'uns' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('uns')}
                className="h-6 px-2 text-[11px] rounded-md"
              >
                UNS
              </Button>
              <Button
                variant={activeTab === 'flow' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('flow')}
                className="h-6 px-2 text-[11px] rounded-md"
              >
                {tText('flowTab')}
              </Button>
            </div>
            {activeStatus && (
              <Badge
                variant={
                  activeTab === 'flow'
                    ? isFlowRunning
                      ? 'default'
                      : isFlowStarting
                        ? 'secondary'
                        : 'outline'
                    : isRunning
                      ? 'default'
                      : isBuilding
                        ? 'secondary'
                        : 'outline'
                }
                className="text-xs rounded-lg font-normal h-5 px-1.5 sm:px-2"
              >
                {activeStatus.status === 'running' && t('running')}
                {activeTab !== 'flow' && activeStatus.status === 'building' && t('building')}
                {activeStatus.status === 'starting' && t('starting')}
                {activeStatus.status === 'stopped' && t('stopped')}
                {activeStatus.status === 'error' && t('error')}
                {activeStatus.status === 'not_started' && t('notStarted')}
              </Badge>
            )}
            {activeTab === 'flow' ? (
              flowStatus?.port && (
                <span className="text-xs text-muted-foreground font-mono hidden sm:inline">
                  :{flowStatus.port}
                </span>
              )
            ) : (
              status?.port && (
              <span className="text-xs text-muted-foreground font-mono hidden sm:inline">
                :{status.port}
              </span>
              )
            )}
          </div>
          <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
            {activeTab === 'view' && isRunning && (
              <>
                <Button
                  variant={editMode ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => (editMode ? exitEditMode() : setEditMode(true))}
                  className="h-6 sm:h-7 rounded-lg px-1.5 sm:px-2.5 text-xs btn-glow"
                  title={editMode ? t('exitEditMode') : t('enterEditMode')}
                >
                  {editMode ? t('editing') : t('edit')}
                </Button>
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
            {activeTab === 'flow' && isFlowRunning && (
              <>
                <Button variant="ghost" size="sm" onClick={handleFlowRefresh} className="h-6 w-6 sm:h-7 sm:w-7 p-0 rounded-lg" title="Refresh">
                  <RefreshIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const flowUrl = sessionId ? `${flowStatus?.url || '/flow/'}#flow/${sessionId}` : (flowStatus?.url || '/flow/');
                    window.open(flowUrl, '_blank');
                  }}
                  className="h-6 w-6 sm:h-7 sm:w-7 p-0 rounded-lg"
                  title="Open in new window"
                >
                  <ExternalLinkIcon />
                </Button>
              </>
            )}
            {activeTab === 'view' && (isRunning || isBuilding) && (
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
        {activeTab === 'view' && editMode && (
          <div className="m-3 px-3 py-2 rounded-xl bg-primary/10 text-primary text-xs">
            {t('clickToSelectComponent')}
          </div>
        )}
        {activeTab === 'view' && isBuilding && (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                <LoaderIcon />
              </div>
              <p className="font-medium">{t('building')}</p>
              <p className="text-xs mt-1 opacity-70">{t('buildingHint')}</p>
            </div>
          </div>
        )}
        
        {activeTab === 'view' && isRunning && status?.url && (
          <iframe
            id="view-iframe"
            ref={iframeRef}
            src={status.url}
            className="w-full h-full border-0 bg-white"
            title="View"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onLoad={attachIframeListeners}
          />
        )}
        
        {activeTab === 'view' && !isRunning && !isBuilding && (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <div className={`w-20 h-20 mx-auto mb-5 rounded-2xl flex items-center justify-center ${error || status?.error ? 'bg-destructive/10 text-destructive' : 'bg-accent/50'}`}>
                <MonitorIcon />
              </div>
              <p className="font-medium mb-1">{error || status?.error ? t('error') : t('viewProject')}</p>
              <p className="text-xs mb-5 opacity-70 max-w-[200px] mx-auto">
                {error || status?.error || t('viewHint')}
              </p>
              <Button
                variant="default"
                size="lg"
                onClick={handleStart}
                disabled={loading}
                className="rounded-xl px-8 py-3 h-12 text-sm font-medium btn-glow flex items-center gap-2 mx-auto"
              >
                <PlayIcon />
                {loading ? t('building') : (error || status?.error ? t('retry') : t('build'))}
              </Button>
            </div>
          </div>
        )}

        {activeTab === 'uns' && (
          <div className="h-full p-3 sm:p-4 flex flex-col gap-3">
            {unsLoading && (
              <div className="px-3 py-2 rounded-xl bg-muted/40 text-xs text-muted-foreground">
                {tText('unsLoading')}
              </div>
            )}
            {unsError && (
              <div className="px-3 py-2 rounded-xl bg-destructive/10 text-destructive text-xs">
                {unsError}
              </div>
            )}
            {!unsLoading && !unsError && unsTopics.length === 0 && (
              <div className="px-3 py-2 rounded-xl bg-muted/40 text-xs text-muted-foreground">
                {tText('unsMissing')}
              </div>
            )}
            {!unsLoading && !unsError && unsTopics.length > 0 && (
              <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-3 min-h-0">
                <div className="rounded-xl border border-border/50 bg-card/60 p-3 overflow-auto">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <div className="text-sm font-semibold">UNS</div>
                      <div className="text-xs text-muted-foreground">{unsMeta || 'UNS dataset'}</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px] px-2">
                        Topics {unsTopics.length}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] px-2">
                        Nodes {unsNodeCount}
                      </Badge>
                    </div>
                  </div>
                  <div className="space-y-1 text-xs">
                    {unsTree.children.map((node) => (
                      <div key={node.path}>
                        <UnsTreeNode
                          node={node}
                          level={0}
                          expanded={unsExpanded}
                          onToggle={toggleUnsNode}
                          onSelect={(path) => setUnsSelectedPath(path)}
                          selectedPath={unsSelectedPath}
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-border/50 bg-card/60 p-3 overflow-auto">
                  {selectedTopic ? (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                          {selectedTopic.type}
                        </Badge>
                        <div className="text-sm font-semibold">
                          {selectedTopic.label || selectedTopic.id}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                        {selectedPathSegments.map((segment, index) => (
                          <span
                            key={`${segment}-${index}`}
                            className="px-1.5 py-0.5 rounded-md bg-muted/60 text-foreground/80"
                          >
                            {segment}
                          </span>
                        ))}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        <div className="rounded-lg border border-border/40 bg-muted/20 px-2.5 py-2">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Path</div>
                          <div className="mt-1 break-all text-foreground/80">{selectedTopic.path}</div>
                        </div>
                        <div className="rounded-lg border border-border/40 bg-muted/20 px-2.5 py-2">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">ID</div>
                          <div className="mt-1 break-all text-foreground/80">{selectedTopic.id}</div>
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                          {tText('unsSchema')}
                        </div>
                        <pre className="text-xs bg-muted/40 rounded-lg p-3 overflow-auto border border-border/40">
{JSON.stringify(selectedTopic.payloadSchema || {}, null, 2)}
                        </pre>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">{tText('unsSelectHint')}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'flow' && flowError && (
          <div className="m-4 p-4 bg-destructive/10 text-destructive text-sm rounded-xl">
            {flowError}
          </div>
        )}

        {activeTab === 'flow' && flowStatus?.error && (
          <div className="m-4 p-4 bg-destructive/10 text-destructive text-sm rounded-xl">
            {flowStatus.error}
          </div>
        )}

        {activeTab === 'flow' && (flowLoading || isFlowStarting) && (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                <LoaderIcon />
              </div>
              <p className="font-medium">{t('flowStarting')}</p>
            </div>
          </div>
        )}

        {activeTab === 'flow' && isFlowRunning && flowStatus?.url && (
          <iframe
            id="flow-iframe"
            ref={flowIframeRef}
            src={sessionId ? `${flowStatus.url}#flow/${sessionId}` : flowStatus.url}
            className="w-full h-full border-0 bg-white"
            title="Flow"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        )}

        {activeTab === 'flow' && !isFlowRunning && !isFlowStarting && !flowLoading && !flowError && !flowStatus?.error && (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-5 rounded-2xl bg-accent/50 flex items-center justify-center">
                <MonitorIcon />
              </div>
              <p className="font-medium mb-1">{t('flowTitle')}</p>
              <p className="text-xs mb-5 opacity-70 max-w-[200px] mx-auto">
                {t('flowHint')}
              </p>
              <Button
                variant="default"
                size="lg"
                onClick={startFlow}
                disabled={flowLoading}
                className="rounded-xl px-8 py-3 h-12 text-sm font-medium btn-glow flex items-center gap-2 mx-auto"
              >
                <PlayIcon />
                {flowLoading ? t('starting') : t('flowStart')}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function UnsTreeNode({
  node,
  level,
  expanded,
  onToggle,
  onSelect,
  selectedPath,
}: {
  node: { name: string; path: string; children: Array<{ name: string; path: string; children: any[]; topic?: UnsTopic }>; topic?: UnsTopic };
  level: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  selectedPath: string | null;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.path);
  const isSelected = selectedPath === node.path;
  const padding = Math.min(48, level * 14);
  const kind = node.topic ? (hasChildren ? 'type' : 'leaf') : 'dir';
  const leafIndent = kind === 'leaf' ? 8 : 0;
  const typeLabel = node.topic?.type?.toUpperCase() ?? '';
  const specialNodes = new Set(['action', 'info', 'state', 'metrics']);
  const isSpecial = specialNodes.has(node.name.toLowerCase());
  return (
    <div>
      <div
        className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 cursor-pointer transition-colors ${
          isSelected ? 'bg-primary/15 text-primary' : 'hover:bg-accent/40'
        } ${level > 0 ? 'border-l-2 border-primary/30' : ''} ${
          kind === 'dir' ? 'font-medium text-foreground/90' : ''
        } ${kind === 'leaf' ? 'bg-card/40' : ''} ${kind === 'type' ? 'bg-primary/5' : ''} ${
          isSpecial ? 'bg-primary/10 ring-1 ring-primary/20' : ''
        }`}
        style={{ marginLeft: padding + leafIndent, paddingLeft: level > 0 ? 12 : 8 }}
        onClick={() => (hasChildren ? onToggle(node.path) : onSelect(node.path))}
      >
        <span className="text-[10px] text-primary w-3 transition-colors group-hover:text-primary">
          {hasChildren ? (isExpanded ? '▾' : '▸') : '•'}
        </span>
        {level > 0 && (
          <span className={`h-px ${kind === 'leaf' ? 'w-4' : 'w-2'} bg-primary/40`} />
        )}
        <span className={`flex-1 truncate ${isSpecial ? 'text-primary font-semibold' : ''}`}>
          {node.name}
        </span>
        {hasChildren && (
          <span className="text-[9px] text-primary/70">
            {node.children.length}
          </span>
        )}
        {node.topic && (
          <Badge
            variant="outline"
            className={`text-[9px] px-1.5 uppercase border-primary/40 text-primary ${
              kind === 'leaf' ? 'bg-primary/10' : 'bg-primary/5'
            }`}
          >
            {typeLabel}
          </Badge>
        )}
      </div>
      {hasChildren && isExpanded && (
        <div className="space-y-1">
          {node.children.map((child) => (
            <UnsTreeNode
              key={child.path}
              node={child}
              level={level + 1}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              selectedPath={selectedPath}
            />
          ))}
        </div>
      )}
      {!hasChildren && node.topic && (
        <div className="hidden" />
      )}
    </div>
  );
}
