import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { useI18n } from '@/contexts/I18nContext';
import type { ViewStatus, PreviewStatus, FlowStatus } from '@/lib/api';
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

const DownloadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
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
  initialTab?: 'preview' | 'production' | 'uns' | 'flow';
}

export function ViewPanel({ sessionId, onSelectComponentContext, onClose, initialTab }: ViewPanelProps) {
  const { t, locale } = useI18n();
  const tText = t as (key: string) => string;
  const stopPreviewLabel = locale === 'zh' ? '停止预览' : 'Stop Preview';
  // Production (build mode) status
  const [status, setStatus] = useState<ViewStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Preview (dev mode) status
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Tabs
  const [activeTab, setActiveTab] = useState<'preview' | 'production' | 'uns' | 'flow'>(initialTab ?? 'preview');
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
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
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

  const fetchPreviewStatus = useCallback(async () => {
    if (!sessionId) return;
    try {
      const result = await api.getPreviewStatus(sessionId);
      setPreviewStatus(result);
      setPreviewError(null);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Failed to get preview status');
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

  // Fetch both statuses on mount
  useEffect(() => {
    fetchStatus();
    fetchPreviewStatus();
  }, [sessionId, fetchStatus, fetchPreviewStatus]);

  // Poll status while building/starting
  useEffect(() => {
    const interval = setInterval(() => {
      if (status?.status === 'building') {
        fetchStatus();
      }
      if (previewStatus?.status === 'starting') {
        fetchPreviewStatus();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchPreviewStatus, status?.status, previewStatus?.status]);

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

  const handleStartPreview = useCallback(async () => {
    if (!sessionId) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await api.startPreview(sessionId);
      setPreviewStatus(result);
      
      // If starting, poll for updates
      if (result.status === 'starting') {
        const checkInterval = setInterval(async () => {
          const updated = await api.getPreviewStatus(sessionId);
          setPreviewStatus(updated);
          if (updated.status !== 'starting') {
            clearInterval(checkInterval);
          }
        }, 1000);
      }
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Failed to start preview');
    } finally {
      setPreviewLoading(false);
    }
  }, [sessionId]);

  const handleStopPreview = async () => {
    if (!sessionId) return;
    setPreviewLoading(true);
    try {
      await api.stopPreview(sessionId);
      setPreviewStatus(null);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Failed to stop preview');
    } finally {
      setPreviewLoading(false);
    }
  };

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

  const handleDownloadPackage = useCallback(() => {
    if (!sessionId) return;
    window.open(`/api/sessions/${sessionId}/view/package`, '_blank');
  }, [sessionId]);

  const handlePreviewRefresh = () => {
    const iframe = previewIframeRef.current;
    if (iframe && previewStatus?.url) {
      iframe.src = previewStatus.url;
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

  const handleIframeHover = useCallback((iframeRefToUse: React.RefObject<HTMLIFrameElement | null>) => (event: MouseEvent) => {
    if (!editModeRef.current) return;
    const doc = iframeRefToUse.current?.contentDocument;
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

  const attachIframeListeners = useCallback((iframeRefToUse: React.RefObject<HTMLIFrameElement | null>) => {
    const iframe = iframeRefToUse.current;
    const doc = iframe?.contentDocument;
    if (!doc) return;
    const hoverHandler = handleIframeHover(iframeRefToUse);
    doc.removeEventListener('click', handleIframeClick, true);
    doc.removeEventListener('mousemove', hoverHandler, true);
    doc.addEventListener('click', handleIframeClick, true);
    doc.addEventListener('mousemove', hoverHandler, true);
  }, [handleIframeClick, handleIframeHover]);

  useEffect(() => {
    editModeRef.current = editMode;
    // Attach listeners to both iframes
    attachIframeListeners(iframeRef);
    attachIframeListeners(previewIframeRef);
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
  const isPreviewRunning = previewStatus?.status === 'running';
  const isPreviewStarting = previewStatus?.status === 'starting';
  const isFlowRunning = flowStatus?.status === 'running';
  const isFlowStarting = flowStatus?.status === 'starting';
  const isPackageReady = Boolean(status?.package_ready);
  const activeStatus = activeTab === 'flow' ? flowStatus : activeTab === 'preview' ? previewStatus : status;

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
    // Exit edit mode when neither preview nor production is running
    if (!isRunning && !isPreviewRunning) {
      setEditMode(false);
      clearHighlight();
      clearHoverHighlight();
      onSelectComponentContext(null);
    }
  }, [isRunning, isPreviewRunning, clearHighlight, clearHoverHighlight, onSelectComponentContext]);

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
                variant={activeTab === 'preview' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('preview')}
                className="h-6 px-2 text-[11px] rounded-md"
              >
                Preview
              </Button>
              <Button
                variant={activeTab === 'production' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('production')}
                className="h-6 px-2 text-[11px] rounded-md"
              >
                Production
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
                    : activeTab === 'preview'
                      ? isPreviewRunning
                        ? 'default'
                        : isPreviewStarting
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
                {activeTab === 'production' && activeStatus.status === 'building' && t('building')}
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
            ) : activeTab === 'preview' ? (
              previewStatus?.port && (
                <span className="text-xs text-muted-foreground font-mono hidden sm:inline">
                  :{previewStatus.port}
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
            {activeTab === 'preview' && isPreviewRunning && (
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
                <Button variant="ghost" size="sm" onClick={handlePreviewRefresh} className="h-6 w-6 sm:h-7 sm:w-7 p-0 rounded-lg" title="Refresh">
                  <RefreshIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(previewStatus?.url || '', '_blank')}
                  className="h-6 w-6 sm:h-7 sm:w-7 p-0 rounded-lg"
                  title="Open in new window"
                >
                  <ExternalLinkIcon />
                </Button>
              </>
            )}
            {activeTab === 'preview' && (isPreviewRunning || isPreviewStarting) && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleStopPreview}
                disabled={previewLoading}
                className="h-8 sm:h-7 rounded-lg px-2.5 sm:px-2.5 text-[11px] sm:text-xs btn-glow flex items-center gap-1"
              >
                <StopIcon />
                <span>{stopPreviewLabel}</span>
              </Button>
            )}
            {activeTab === 'production' && isRunning && (
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
                {isPackageReady && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDownloadPackage}
                    className="h-6 sm:h-7 rounded-lg px-1.5 sm:px-2.5 text-xs btn-glow flex items-center gap-1"
                    title={tText('downloadPackage')}
                  >
                    <DownloadIcon />
                    <span className="hidden sm:inline">{tText('downloadPackage')}</span>
                  </Button>
                )}
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
            {activeTab === 'production' && (isRunning || isBuilding) && (
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
            <Button variant="ghost" size="sm" onClick={onClose} className="h-6 w-6 sm:h-7 sm:w-7 p-0 rounded-lg transition-transform duration-200 hover:scale-110 hover:rotate-90">
              <CloseIcon />
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 p-0 overflow-hidden bg-muted/20">
        {/* Preview Tab (Dev Mode with HMR) */}
        {activeTab === 'preview' && editMode && (
          <div className="m-3 px-3 py-2 rounded-xl bg-primary/10 text-primary text-xs">
            {t('clickToSelectComponent')}
          </div>
        )}
        {activeTab === 'preview' && isPreviewStarting && (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                <LoaderIcon />
              </div>
              <p className="font-medium">{t('starting')}</p>
              <p className="text-xs mt-1 opacity-70">Starting dev server with HMR...</p>
            </div>
          </div>
        )}
        
        {activeTab === 'preview' && isPreviewRunning && previewStatus?.url && (
          <iframe
            id="preview-iframe"
            ref={previewIframeRef}
            src={previewStatus.url}
            className="w-full h-full border-0 bg-white"
            title="Preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onLoad={() => attachIframeListeners(previewIframeRef)}
          />
        )}
        
        {activeTab === 'preview' && !isPreviewRunning && !isPreviewStarting && (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <div className={`w-20 h-20 mx-auto mb-5 rounded-2xl flex items-center justify-center ${previewError || previewStatus?.error ? 'bg-destructive/10 text-destructive' : 'bg-accent/50'}`}>
                <MonitorIcon />
              </div>
              <p className="font-medium mb-1">{previewError || previewStatus?.error ? t('error') : 'Preview'}</p>
              <p className="text-xs mb-5 opacity-70 max-w-[200px] mx-auto">
                {previewError || previewStatus?.error || 'Start dev server with live reload'}
              </p>
              <Button
                variant="default"
                size="lg"
                onClick={handleStartPreview}
                disabled={previewLoading}
                className="rounded-xl px-8 py-3 h-12 text-sm font-medium btn-glow flex items-center gap-2 mx-auto"
              >
                <PlayIcon />
                {previewLoading ? t('starting') : (previewError || previewStatus?.error ? t('retry') : 'Start Preview')}
              </Button>
            </div>
          </div>
        )}

        {/* Production Tab (Build Mode) */}
        {activeTab === 'production' && editMode && (
          <div className="m-3 px-3 py-2 rounded-xl bg-primary/10 text-primary text-xs">
            {t('clickToSelectComponent')}
          </div>
        )}
        {activeTab === 'production' && isBuilding && (
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
        
        {activeTab === 'production' && isRunning && status?.url && (
          <iframe
            id="view-iframe"
            ref={iframeRef}
            src={status.url}
            className="w-full h-full border-0 bg-white"
            title="Production"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onLoad={() => attachIframeListeners(iframeRef)}
          />
        )}
        
        {activeTab === 'production' && !isRunning && !isBuilding && (
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
              <div className="flex items-center gap-2 px-3 py-3 rounded-xl bg-muted/40 text-sm text-muted-foreground">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8" className="opacity-75" />
                </svg>
                {tText('unsLoading')}
              </div>
            )}
            {unsError && (
              <div className="px-3 py-3 rounded-xl bg-destructive/10 text-destructive text-sm">
                {unsError}
              </div>
            )}
            {!unsLoading && !unsError && unsTopics.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                <svg className="w-12 h-12 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M9 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <path d="M15 3h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-4" />
                  <path d="M12 3v18" />
                  <path d="M9 21h6" />
                </svg>
                <div className="text-sm">{tText('unsMissing')}</div>
              </div>
            )}
            {!unsLoading && !unsError && unsTopics.length > 0 && (
              <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-3 min-h-0">
                {/* Tree Panel */}
                <div className="rounded-xl border border-border/50 bg-card/60 flex flex-col overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-b border-border/30 bg-muted/20">
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                      </svg>
                      <span className="text-sm font-semibold">UNS</span>
                      {unsMeta && (
                        <span className="text-xs text-muted-foreground">· {unsMeta}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span>{unsTopics.length} topics</span>
                      <span>·</span>
                      <span>{unsNodeCount} nodes</span>
                    </div>
                  </div>
                  {/* Tree Content */}
                  <div className="flex-1 overflow-auto p-2">
                    {unsTree.children.map((node) => (
                      <UnsTreeNode
                        key={node.path}
                        node={node}
                        level={0}
                        expanded={unsExpanded}
                        onToggle={toggleUnsNode}
                        onSelect={(path) => setUnsSelectedPath(path)}
                        selectedPath={unsSelectedPath}
                      />
                    ))}
                  </div>
                </div>
                
                {/* Detail Panel */}
                <div className="rounded-xl border border-border/50 bg-card/60 flex flex-col overflow-hidden">
                  {selectedTopic ? (
                    <>
                      {/* Detail Header */}
                      <div className="px-3 py-2.5 border-b border-border/30 bg-muted/20">
                        <div className="flex items-center gap-2">
                          <span className="flex-shrink-0">
                            <UnsIcon type={selectedTopic.type} hasChildren={false} />
                          </span>
                          <span className="text-sm font-semibold truncate">
                            {selectedTopic.label || selectedTopic.id}
                          </span>
                          <Badge 
                            className={`ml-auto text-[10px] uppercase tracking-wide ${
                              selectedTopic.type === 'state' 
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                : selectedTopic.type === 'action'
                                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                  : selectedTopic.type === 'metric' || selectedTopic.type === 'metrics'
                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                    : 'bg-muted text-muted-foreground'
                            }`}
                          >
                            {selectedTopic.type}
                          </Badge>
                        </div>
                      </div>
                      
                      {/* Detail Content */}
                      <div className="flex-1 overflow-auto p-3 space-y-4">
                        {/* Path breadcrumb */}
                        <div className="flex flex-wrap items-center gap-1 text-[12px]">
                          {selectedPathSegments.map((segment, index) => (
                            <span key={`${segment}-${index}`} className="flex items-center gap-1">
                              {index > 0 && <span className="text-muted-foreground/50">/</span>}
                              <span className={`px-1.5 py-0.5 rounded ${
                                index === selectedPathSegments.length - 1
                                  ? 'bg-primary/10 text-primary font-medium'
                                  : 'text-muted-foreground'
                              }`}>
                                {segment}
                              </span>
                            </span>
                          ))}
                        </div>
                        
                        {/* Info cards */}
                        <div className="grid grid-cols-1 gap-2 text-xs">
                          <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Full Path</div>
                            <div className="font-mono text-foreground/80 break-all">{selectedTopic.path}</div>
                          </div>
                          <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">ID</div>
                            <div className="font-mono text-foreground/80 break-all">{selectedTopic.id}</div>
                          </div>
                        </div>
                        
                        {/* Schema */}
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <svg className="w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <polyline points="14,2 14,8 20,8" />
                              <line x1="16" y1="13" x2="8" y2="13" />
                              <line x1="16" y1="17" x2="8" y2="17" />
                              <line x1="10" y1="9" x2="8" y2="9" />
                            </svg>
                            <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                              {tText('unsSchema')}
                            </span>
                          </div>
                          <pre className="text-xs font-mono bg-slate-950 text-slate-300 rounded-lg p-3 overflow-auto border border-border/40 max-h-[300px]">
{JSON.stringify(selectedTopic.payloadSchema || {}, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                      <svg className="w-10 h-10 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M15 15l6 6m-11-4a7 7 0 110-14 7 7 0 010 14z" />
                      </svg>
                      <div className="text-sm">{tText('unsSelectHint')}</div>
                    </div>
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

// Icon components for UNS tree
const UnsIcon = ({ type, hasChildren, isTypeCategory }: { type?: string; hasChildren: boolean; isTypeCategory?: boolean }) => {
  // Determine icon based on type
  const iconType = type?.toLowerCase();
  
  if (iconType === 'action') {
    return (
      <svg className="w-4 h-4 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M7 17L17 7M17 7H7M17 7V17" />
      </svg>
    );
  }
  
  if (iconType === 'metric' || iconType === 'metrics') {
    return (
      <svg className="w-4 h-4 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 3v18h18" />
        <path d="M18 17V9" />
        <path d="M13 17V5" />
        <path d="M8 17v-3" />
      </svg>
    );
  }
  
  if (iconType === 'state') {
    return (
      <svg className="w-4 h-4 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
        <path d="M14 2v6h6" fill="none" stroke="white" strokeWidth="1" />
      </svg>
    );
  }
  
  if (iconType === 'info') {
    return (
      <svg className="w-4 h-4 text-cyan-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </svg>
    );
  }
  
  // Type category containers (Action, Metric, State, Info as folder names)
  if (isTypeCategory) {
    const catType = isTypeCategory ? type : undefined;
    if (catType === 'action') {
      return (
        <svg className="w-4 h-4 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M7 17L17 7M17 7H7M17 7V17" />
        </svg>
      );
    }
    if (catType === 'metric') {
      return (
        <svg className="w-4 h-4 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 3v18h18" />
          <path d="M18 17V9" />
          <path d="M13 17V5" />
          <path d="M8 17v-3" />
        </svg>
      );
    }
    if (catType === 'state') {
      return (
        <svg className="w-4 h-4 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
          <path d="M14 2v6h6" fill="none" stroke="white" strokeWidth="1" />
        </svg>
      );
    }
  }
  
  // Directory/namespace node - chain link icon
  if (hasChildren) {
    return (
      <svg className="w-4 h-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    );
  }
  
  // Leaf node without specific type
  return (
    <svg className="w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
};

// Count all descendants recursively
const countDescendants = (node: { children: Array<{ children: unknown[] }> }): number => {
  let count = node.children.length;
  for (const child of node.children) {
    count += countDescendants(child as { children: Array<{ children: unknown[] }> });
  }
  return count;
};

function UnsTreeNode({
  node,
  level,
  expanded,
  onToggle,
  onSelect,
  selectedPath,
}: {
  node: { name: string; path: string; children: Array<{ name: string; path: string; children: unknown[]; topic?: UnsTopic }>; topic?: UnsTopic };
  level: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  selectedPath: string | null;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.path);
  const isSelected = selectedPath === node.path;
  const nodeType = node.topic?.type;
  const descendantCount = hasChildren ? countDescendants(node) : 0;
  
  // Indentation: 20px per level
  const indent = level * 20;
  
  // Special type categories (containers)
  const typeCategories = ['action', 'metric', 'metrics', 'state', 'info'];
  const isTypeCategory = typeCategories.includes(node.name.toLowerCase());
  const typeCategoryName = isTypeCategory ? node.name.toLowerCase() : undefined;
  
  return (
    <div className="select-none">
      <div
        className={`group flex items-center gap-1.5 py-1 pr-2 cursor-pointer transition-all duration-150 rounded-md ${
          isSelected 
            ? 'bg-primary/10' 
            : 'hover:bg-muted/50'
        }`}
        style={{ paddingLeft: indent + 4 }}
        onClick={() => {
          if (hasChildren) {
            onToggle(node.path);
          }
          if (node.topic) {
            onSelect(node.path);
          }
        }}
      >
        {/* Expand/Collapse indicator */}
        <span className={`flex items-center justify-center w-4 h-4 text-muted-foreground transition-transform duration-200 ${
          hasChildren ? 'cursor-pointer' : 'opacity-0'
        } ${isExpanded ? '' : ''}`}>
          {hasChildren && (
            <svg className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5l8 7-8 7V5z" />
            </svg>
          )}
        </span>
        
        {/* Icon */}
        <span className="flex-shrink-0">
          <UnsIcon 
            type={nodeType || typeCategoryName} 
            hasChildren={hasChildren} 
            isTypeCategory={isTypeCategory}
          />
        </span>
        
        {/* Name */}
        <span className={`flex-1 truncate text-[13px] ${
          isSelected 
            ? 'text-primary font-medium' 
            : isTypeCategory
              ? 'font-semibold text-foreground'
              : hasChildren 
                ? 'font-medium text-foreground' 
                : 'text-foreground/80'
        }`}>
          {node.name}
        </span>
        
        {/* Count badge */}
        {hasChildren && (
          <span className="text-[11px] text-muted-foreground">
            ({descendantCount})
          </span>
        )}
      </div>
      
      {/* Children */}
      {hasChildren && isExpanded && (
        <div className="relative">
          {/* Vertical connecting line */}
          <div 
            className="absolute top-0 bottom-2 w-px bg-border/60"
            style={{ left: indent + 11 }}
          />
          {node.children.map((child) => (
            <UnsTreeNode
              key={child.path}
              node={child as { name: string; path: string; children: Array<{ name: string; path: string; children: unknown[]; topic?: UnsTopic }>; topic?: UnsTopic }}
              level={level + 1}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              selectedPath={selectedPath}
            />
          ))}
        </div>
      )}
    </div>
  );
}
