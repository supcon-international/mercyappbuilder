import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useSessions } from '@/hooks/useSession';
import { useI18n } from '@/contexts/I18nContext';
import type { Session } from '@/types';
import { useState } from 'react';

// Claude 4.5 model options
const CLAUDE_MODELS = [
  { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5', thinking: true, description: '最强大，支持思考' },
  { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', thinking: true, description: '平衡性能，支持思考' },
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', thinking: false, description: '强大稳定' },
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', thinking: false, description: '快速高效' },
  { id: 'claude-haiku-4-5-20251212', name: 'Claude Haiku 4.5', thinking: false, description: '最快速，成本最低' },
];

interface SessionListProps {
  selectedSession: Session | null;
  onSelectSession: (session: Session) => void;
}

export function SessionList({ selectedSession, onSelectSession }: SessionListProps) {
  const { sessions, loading, error, fetchSessions, createSession, deleteSession, updateSessionName } = useSessions();
  const { t, locale } = useI18n();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renamingSession, setRenamingSession] = useState<Session | null>(null);
  const defaultSystemPrompt = locale === 'zh' 
    ? '基于 claude.md 完成应用构建' 
    : 'Build applications based on claude.md';
  const [systemPrompt, setSystemPrompt] = useState(defaultSystemPrompt);
  const [createDisplayName, setCreateDisplayName] = useState('');
  const [renameDisplayName, setRenameDisplayName] = useState('');
  // Default to Opus 4.5 with thinking enabled
  const [model, setModel] = useState('claude-opus-4-5-20251101');

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleCreateSession = async () => {
    try {
      const session = await createSession({
        system_prompt: systemPrompt || defaultSystemPrompt,
        model,
        display_name: createDisplayName || null,
      });
      onSelectSession(session);
      setCreateDialogOpen(false);
      setSystemPrompt(defaultSystemPrompt);
      setCreateDisplayName('');
    } catch {
      // Error handled by hook
    }
  };

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(t('deleteConfirm'))) {
      await deleteSession(sessionId);
      if (selectedSession?.session_id === sessionId) {
        onSelectSession(sessions.find(s => s.session_id !== sessionId) || null as unknown as Session);
      }
    }
  };

  const handleOpenRename = (session: Session, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingSession(session);
    setRenameDisplayName(session.display_name || '');
    setRenameDialogOpen(true);
  };

  const handleRenameSession = async () => {
    if (!renamingSession) return;
    try {
      await updateSessionName(renamingSession.session_id, renameDisplayName || null);
      setRenameDialogOpen(false);
      setRenamingSession(null);
      setRenameDisplayName('');
    } catch {
      // Error handled by hook
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-500';
      case 'busy':
        return 'bg-yellow-500';
      case 'idle':
        return 'bg-gray-500';
      case 'closed':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 sm:p-4 pb-2 sm:pb-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('sessions')}</h2>
          <Dialog
            open={createDialogOpen}
            onOpenChange={(open) => {
              setCreateDialogOpen(open);
              if (!open) {
                setCreateDisplayName('');
              }
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm" className="rounded-lg h-7 px-2 sm:px-2.5 text-xs font-medium btn-glow">{t('newSession')}</Button>
            </DialogTrigger>
            <DialogContent className="w-[95vw] max-w-md mx-auto">
              <DialogHeader>
                <DialogTitle>{t('createSession')}</DialogTitle>
                <DialogDescription>
                  {t('createSessionDesc')}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <label htmlFor="display-name" className="text-sm font-medium">
                    {t('sessionName')}
                  </label>
                  <Textarea
                    id="display-name"
                    value={createDisplayName}
                    onChange={(e) => setCreateDisplayName(e.target.value)}
                    placeholder={t('sessionNamePlaceholder')}
                    rows={1}
                  />
                </div>
                <div className="grid gap-2">
                  <label htmlFor="model" className="text-sm font-medium">
                    {t('model')}
                  </label>
                  <Select value={model} onValueChange={setModel}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder={t('selectModel')} />
                    </SelectTrigger>
                    <SelectContent>
                      {CLAUDE_MODELS.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{m.name}</span>
                            {m.thinking && (
                              <span className="text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                                {locale === 'zh' ? '思考' : 'Thinking'}
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <label htmlFor="system-prompt" className="text-sm font-medium">
                    {t('systemPrompt')}
                  </label>
                  <Textarea
                    id="system-prompt"
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder={t('systemPromptPlaceholder')}
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setCreateDialogOpen(false)} className="btn-glow h-8">
                  {t('cancel')}
                </Button>
                <Button size="sm" onClick={handleCreateSession} disabled={loading} className="btn-glow h-8">
                  {loading ? t('creating') : t('create')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog
            open={renameDialogOpen}
            onOpenChange={(open) => {
              setRenameDialogOpen(open);
              if (!open) {
                setRenamingSession(null);
                setRenameDisplayName('');
              }
            }}
          >
            <DialogContent className="w-[95vw] max-w-md mx-auto">
              <DialogHeader>
                <DialogTitle>{t('renameSession')}</DialogTitle>
                <DialogDescription>
                  {t('sessionNamePlaceholder')}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <label htmlFor="rename-display-name" className="text-sm font-medium">
                    {t('sessionName')}
                  </label>
                  <Textarea
                    id="rename-display-name"
                    value={renameDisplayName}
                    onChange={(e) => setRenameDisplayName(e.target.value)}
                    placeholder={t('sessionNamePlaceholder')}
                    rows={1}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setRenameDialogOpen(false)} className="btn-glow h-8">
                  {t('cancel')}
                </Button>
                <Button size="sm" onClick={handleRenameSession} disabled={loading} className="btn-glow h-8">
                  {t('save')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        {error && (
          <div className="px-4 py-2 text-sm text-destructive bg-destructive/5 rounded-lg mx-4">
            {error}
          </div>
        )}
        <ScrollArea className="h-full">
          <div className="px-2 sm:px-3 pb-3 space-y-1">
            {sessions.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                <div className="text-3xl mb-3 opacity-50 transition-transform duration-300 hover:scale-125 cursor-default">💬</div>
                <p>{t('noSessions')}</p>
                <p className="text-xs mt-1">{t('clickToCreate')}</p>
              </div>
            ) : (
              sessions.map((session) => (
                (() => {
                  const name = (session.display_name || '').trim();
                  const title = name || session.session_id.slice(0, 8);
                  return (
                <div
                  key={session.session_id}
                  className={`p-3 rounded-xl cursor-pointer transition-all duration-300 group glow-border ${
                    selectedSession?.session_id === session.session_id
                      ? 'bg-primary/15 border border-primary/30 shadow-md shadow-primary/10 scale-[1.02]'
                      : 'hover:bg-accent/50 hover:translate-x-1 border border-transparent'
                  }`}
                  onClick={() => onSelectSession(session)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${getStatusColor(session.status)} ${session.status === 'active' ? 'animate-pulse' : ''}`} />
                      <span className="text-xs font-medium text-foreground">
                        {title}
                      </span>
                      {name && (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {session.session_id.slice(0, 8)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                        onClick={(e) => handleOpenRename(session, e)}
                      >
                        {t('editName')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                        onClick={(e) => handleDeleteSession(session.session_id, e)}
                      >
                        ×
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">
                      {session.message_count} {t('messages')}
                    </span>
                    <span className="text-xs text-muted-foreground/50">·</span>
                    <span className="text-xs text-muted-foreground">
                      {formatTime(session.last_activity)}
                    </span>
                    <span className="text-xs text-muted-foreground/50">·</span>
                    <span className="text-xs text-primary/70 font-medium">
                      {session.model.includes('opus') ? 'Opus' : 
                       session.model.includes('haiku') ? 'Haiku' : 'Sonnet'}
                    </span>
                  </div>
                </div>
                  );
                })()
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
