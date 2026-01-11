import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useChat } from '@/hooks/useSession';
import { useI18n } from '@/contexts/I18nContext';
import type { Session, ChatMessage, ToolUse } from '@/types';
import type { PermissionRequest } from '@/lib/api';

interface ChatPanelProps {
  session: Session | null;
}

// Tool progress indicator component
function ToolProgressIndicator({ tools, isStreaming, t }: { tools: ToolUse[]; isStreaming?: boolean; t: (key: string) => string }) {
  if (!tools || tools.length === 0) return null;
  
  const completedCount = tools.filter(t => t.result).length;
  const currentTool = tools.find(t => !t.result) || tools[tools.length - 1];
  const allDone = completedCount === tools.length;
  
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
      {isStreaming && !allDone ? (
        <>
          <span className="animate-spin">⚙️</span>
          <span className="text-foreground font-medium">{currentTool.tool}</span>
          <span>{t('executing')}</span>
          {tools.length > 1 && (
            <span className="text-muted-foreground">
              ({completedCount + 1}/{tools.length})
            </span>
          )}
        </>
      ) : (
        <>
          <span>✅</span>
          <span>{t('completed')} {completedCount} {t('toolCalls')}</span>
        </>
      )}
    </div>
  );
}

// Thinking process component
function ThinkingBlock({ thinking, isStreaming, t }: { thinking: string; isStreaming?: boolean; t: (key: string) => string }) {
  const [isOpen, setIsOpen] = useState(true);

  if (!thinking) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="mb-2">
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-2 w-full text-left p-2 rounded-md bg-purple-500/10 hover:bg-purple-500/20 transition-colors border border-purple-500/20">
          <span className="text-sm">💭</span>
          <span className="font-medium text-sm text-purple-700 dark:text-purple-300 flex-1">
            {t('thinkingProcess')}
          </span>
          {isStreaming && (
            <span className="animate-pulse text-purple-500">●</span>
          )}
          <span className="text-xs text-muted-foreground">
            {isOpen ? '▼' : '▶'}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 p-3 rounded-md bg-purple-500/5 border border-purple-500/10 text-sm text-muted-foreground whitespace-pre-wrap">
          {thinking}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Permission request card component
function PermissionRequestCard({ 
  request, 
  onRespond,
  t 
}: { 
  request: PermissionRequest; 
  onRespond: (requestId: string, decision: 'allow' | 'deny') => void;
  t: (key: string) => string;
}) {
  const [responding, setResponding] = useState(false);
  
  const handleRespond = async (decision: 'allow' | 'deny') => {
    setResponding(true);
    try {
      await onRespond(request.request_id, decision);
    } finally {
      setResponding(false);
    }
  };
  
  // Format tool input for display
  const inputDisplay = JSON.stringify(request.tool_input, null, 2);
  const truncatedInput = inputDisplay.length > 500 
    ? inputDisplay.slice(0, 500) + '...' 
    : inputDisplay;
  
  return (
    <div className="mb-4 message-bubble">
      <div className="max-w-[90%] mx-auto">
        <Card className="border-2 border-yellow-500/50 bg-yellow-500/5 shadow-lg animate-pulse-slow">
          <CardHeader className="py-3 px-4">
            <div className="flex items-center gap-2">
              <span className="text-xl">⚠️</span>
              <CardTitle className="text-base font-semibold text-yellow-700 dark:text-yellow-300">
                {t('permissionRequired')}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="space-y-3">
              <div>
                <span className="text-sm font-medium text-muted-foreground">{t('tool')}:</span>
                <span className="ml-2 font-mono text-sm bg-muted px-2 py-0.5 rounded">
                  {request.tool_name}
                </span>
              </div>
              
              <div>
                <span className="text-sm font-medium text-muted-foreground">{t('parameters')}:</span>
                <pre className="mt-1 p-2 bg-muted rounded text-xs font-mono overflow-x-auto max-h-32">
                  {truncatedInput}
                </pre>
              </div>
              
              {request.suggestions.length > 0 && (
                <div>
                  <span className="text-sm font-medium text-muted-foreground">{t('suggestions')}:</span>
                  <ul className="mt-1 text-sm list-disc list-inside">
                    {request.suggestions.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              <div className="flex gap-2 pt-2">
                <Button 
                  size="sm" 
                  className="flex-1 btn-glow bg-green-600 hover:bg-green-700"
                  onClick={() => handleRespond('allow')}
                  disabled={responding}
                >
                  {responding ? '...' : t('approve')}
                </Button>
                <Button 
                  size="sm" 
                  variant="outline"
                  className="flex-1 hover:bg-red-500/10 hover:border-red-500/50 hover:text-red-600"
                  onClick={() => handleRespond('deny')}
                  disabled={responding}
                >
                  {responding ? '...' : t('deny')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Markdown 渲染组件
function MarkdownContent({ content, className }: { content: string; className?: string }) {
  return (
    <div className={`prose prose-sm dark:prose-invert max-w-none ${className || ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 自定义代码块渲染
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const isInline = !match && !className;
            
            if (isInline) {
              return (
                <code className="px-1 py-0.5 rounded bg-muted text-xs font-mono" {...props}>
                  {children}
                </code>
              );
            }
            
            return (
              <div className="my-2 rounded-md overflow-hidden border not-prose">
                {match && (
                  <div className="px-3 py-1 bg-muted text-xs text-muted-foreground border-b">
                    {match[1]}
                  </div>
                )}
                <pre className="p-3 overflow-x-auto bg-muted/50 text-xs">
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              </div>
            );
          },
          // 自定义段落
          p({ children }) {
            return <p className="mb-2 last:mb-0">{children}</p>;
          },
          // 自定义列表
          ul({ children }) {
            return <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>;
          },
          // 自定义链接
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                {children}
              </a>
            );
          },
          // 自定义标题
          h1({ children }) {
            return <h1 className="text-xl font-bold mb-2 mt-4 first:mt-0">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="text-lg font-bold mb-2 mt-3 first:mt-0">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="text-base font-bold mb-2 mt-2 first:mt-0">{children}</h3>;
          },
          // 自定义表格
          table({ children }) {
            return (
              <div className="overflow-x-auto my-2">
                <table className="min-w-full border-collapse border border-border text-sm">
                  {children}
                </table>
              </div>
            );
          },
          th({ children }) {
            return <th className="border border-border px-2 py-1 bg-muted font-medium">{children}</th>;
          },
          td({ children }) {
            return <td className="border border-border px-2 py-1">{children}</td>;
          },
          // 自定义引用块
          blockquote({ children }) {
            return (
              <blockquote className="border-l-4 border-primary/50 pl-4 py-1 my-2 italic text-muted-foreground">
                {children}
              </blockquote>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// Message bubble component - Clean Room Style with animations
function MessageBubble({ message, t, locale }: { message: ChatMessage; t: (key: string) => string; locale: string }) {
  const isUser = message.role === 'user';
  const isStreaming = message.isStreaming;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4 message-bubble`}>
      <div
        className={`max-w-[80%] rounded-2xl p-4 transition-all duration-300 ${
          isUser
            ? 'bg-primary text-primary-foreground shadow-sm hover:shadow-md hover:shadow-primary/20'
            : 'bg-card border border-border/50 shadow-sm hover:shadow-md hover:border-primary/20'
        }`}
      >
        {/* Thinking process */}
        {!isUser && message.thinking && (
          <ThinkingBlock thinking={message.thinking} isStreaming={isStreaming} t={t} />
        )}
        
        {/* Message content */}
        {message.content ? (
          isUser ? (
            <div className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</div>
          ) : (
            <MarkdownContent content={message.content} className="text-sm" />
          )
        ) : isStreaming ? (
          <div className="flex items-center gap-2">
            <span className="animate-pulse text-primary">●</span>
            <span className="text-sm text-muted-foreground">{t('generating')}</span>
          </div>
        ) : null}
        
        {/* Tool progress - current status only */}
        {!isUser && message.tool_use && message.tool_use.length > 0 && (
          <ToolProgressIndicator tools={message.tool_use} isStreaming={isStreaming} t={t} />
        )}
        
        {/* Timestamp and status */}
        <div className={`text-xs mt-3 flex items-center justify-between ${isUser ? 'text-primary-foreground/60' : 'text-muted-foreground/60'}`}>
          <span>{new Date(message.timestamp).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</span>
          {isStreaming && (
            <span className="flex items-center gap-1.5 text-primary">
              <span className="animate-pulse">●</span>
              <span className="text-xs">{t('streaming')}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function ChatPanel({ session }: ChatPanelProps) {
  const {
    messages,
    loading,
    streaming,
    error,
    permissionRequests,
    sendMessageStream,
    stopStreaming,
    respondToPermission,
  } = useChat(session?.session_id || null);
  const { t, locale } = useI18n();
  const [input, setInput] = useState('');
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto scroll to bottom
    const scrollArea = scrollAreaRef.current;
    if (scrollArea) {
      const scrollContainer = scrollArea.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading || streaming) return;

    const message = input.trim();
    setInput('');
    await sendMessageStream(message);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  if (!session) {
    return (
      <Card className="h-full flex items-center justify-center gap-0 py-0 border-border/50 shadow-sm card-hover">
        <div className="text-center text-muted-foreground">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-accent/50 flex items-center justify-center transition-transform duration-300 hover:scale-110">
            <span className="text-2xl">💬</span>
          </div>
          <p className="font-medium">{t('selectSession')}</p>
          <p className="text-sm mt-1 opacity-70">{t('orCreateNew')}</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col gap-0 py-0 overflow-hidden border-border/50 shadow-sm card-hover">
      <CardHeader className="py-2.5 px-4 flex-shrink-0 border-b border-border/30">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-medium">{t('conversation')}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono truncate max-w-[400px] opacity-70">
              {session.working_directory.split('/').slice(-2).join('/')}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary" className="text-xs rounded-lg font-normal h-5 px-2">{session.model.split('-').slice(0,2).join('-')}</Badge>
            <Badge
              variant={session.status === 'active' ? 'default' : 'secondary'}
              className="text-xs rounded-lg font-normal h-5 px-2"
            >
              {session.status}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <Separator className="flex-shrink-0" />
      <CardContent className="flex-1 p-0 flex flex-col min-h-0 overflow-hidden">
        <ScrollArea className="flex-1 min-h-0" ref={scrollAreaRef}>
          <div className="p-4">
            {messages.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <div className="text-4xl mb-4">🤖</div>
                  <p>{t('startNewChat')}</p>
                  <p className="text-sm mt-1">{t('agentWorkDir')}</p>
                </div>
              </div>
            ) : (
              <>
                {messages.map((message, index) => (
                  <MessageBubble key={index} message={message} t={t} locale={locale} />
                ))}
                
                {/* Permission request cards */}
                {permissionRequests.map((request) => (
                  <PermissionRequestCard
                    key={request.request_id}
                    request={request}
                    onRespond={respondToPermission}
                    t={t}
                  />
                ))}
              </>
            )}
          </div>
        </ScrollArea>
        
        {error && (
          <div className="mx-4 mb-2 px-4 py-2 bg-destructive/10 text-destructive text-sm rounded-xl flex-shrink-0">
            {error}
          </div>
        )}
        
        <div className="p-3 border-t border-border/30 flex-shrink-0 bg-card/50 backdrop-blur-sm">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('inputPlaceholder')}
              className="min-h-[48px] max-h-[100px] resize-none rounded-xl border-border/50 bg-background/80 focus:bg-background transition-all duration-300 input-glow text-sm"
              disabled={loading || streaming || session.status === 'closed'}
            />
            <div className="flex flex-col justify-end">
              {streaming ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={stopStreaming}
                  className="rounded-xl h-9 px-3 btn-glow"
                >
                  {t('stop')}
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="sm"
                  disabled={!input.trim() || loading || session.status === 'closed'}
                  className="rounded-xl h-9 px-4 btn-glow"
                >
                  {t('send')}
                </Button>
              )}
            </div>
          </form>
          <p className="text-xs text-muted-foreground/50 mt-1.5 text-center">
            {t('enterToSend')}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
