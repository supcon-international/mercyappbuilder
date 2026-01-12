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

// Extended tool type with live streaming info
interface ExtendedTool extends ToolUse {
  id?: string;
  inputRaw?: string;
  status?: 'running' | 'done';
}

// Todo item from TodoWrite tool
interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  id?: string;
}

// Extract the latest todos from tool_use array
function extractLatestTodos(tools: ToolUse[]): TodoItem[] | null {
  // Defensive check
  if (!tools || !Array.isArray(tools)) return null;
  
  // Find the last TodoWrite tool
  for (let i = tools.length - 1; i >= 0; i--) {
    const tool = tools[i];
    if (tool?.tool === 'TodoWrite' && Array.isArray(tool.input?.todos)) {
      return tool.input.todos as TodoItem[];
    }
  }
  return null;
}

// Todo list display component
function TodoListDisplay({ todos, t }: { todos: TodoItem[]; t: (key: string) => string }) {
  // Defensive: ensure todos is a valid array
  if (!todos || !Array.isArray(todos) || todos.length === 0) return null;
  
  const completedCount = todos.filter(t => t.status === 'completed').length;
  const inProgressItem = todos.find(t => t.status === 'in_progress');
  const progress = Math.round((completedCount / todos.length) * 100);
  
  return (
    <div className="mt-3 p-3 bg-muted/30 rounded-lg border border-border/30">
      {/* Header with progress */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 11l3 3L22 4"/>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
          </svg>
          {t('taskProgress')}
        </span>
        <Badge variant="outline" className="text-xs h-5 px-2">
          {completedCount}/{todos.length}
        </Badge>
      </div>
      
      {/* Progress bar */}
      <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-3">
        <div 
          className="h-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      
      {/* Current task highlight */}
      {inProgressItem && (
        <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-md mb-2 text-sm">
          <span className="animate-pulse text-primary">●</span>
          <span className="text-primary font-medium truncate">{inProgressItem.content}</span>
        </div>
      )}
      
      {/* Todo list */}
      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {todos.map((todo, index) => (
          <div 
            key={todo.id || index}
            className={`flex items-start gap-2 text-xs py-1 px-1.5 rounded transition-colors ${
              todo.status === 'completed' ? 'text-muted-foreground' :
              todo.status === 'in_progress' ? 'text-foreground bg-accent/30' :
              'text-muted-foreground'
            }`}
          >
            {/* Checkbox */}
            <div className={`w-4 h-4 flex-shrink-0 rounded border mt-0.5 flex items-center justify-center ${
              todo.status === 'completed' ? 'bg-primary border-primary' :
              todo.status === 'in_progress' ? 'border-primary animate-pulse' :
              'border-muted-foreground/40'
            }`}>
              {todo.status === 'completed' && (
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
              {todo.status === 'in_progress' && (
                <div className="w-2 h-2 bg-primary rounded-full" />
              )}
            </div>
            
            {/* Content */}
            <span className={todo.status === 'completed' ? 'line-through' : ''}>
              {todo.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Simple tool list - shows completed tool count only
function ToolProgressIndicator({ tools, isStreaming }: { 
  tools: ExtendedTool[]; 
  isStreaming?: boolean; 
  currentToolName?: string;
  t: (key: string) => string;
}) {
  if (!tools || !Array.isArray(tools) || tools.length === 0) return null;
  
  // Find the last tool (current one being executed if streaming)
  const lastToolIndex = tools.length - 1;
  const completedCount = tools.filter(t => t?.result).length;
  
  return (
    <div className="mt-3 flex flex-wrap gap-1.5 items-center">
      {tools.map((tool, index) => {
        // Only the last tool without result is active
        const isActive = isStreaming && index === lastToolIndex && !tool.result;
        const isDone = !!tool.result;
        
        return (
          <span
            key={(tool as ExtendedTool).id || index}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-all ${
              isActive
                ? 'bg-primary/15 text-primary border border-primary/30'
                : isDone
                ? 'bg-muted/50 text-muted-foreground'
                : 'bg-muted/30 text-muted-foreground/70'
            }`}
          >
            <span className={isActive ? 'animate-spin' : ''}>
              {isActive ? '⚙️' : isDone ? '✓' : '○'}
            </span>
            <span className="truncate max-w-[120px]">{tool.tool}</span>
          </span>
        );
      })}
      {/* Only show count after completion */}
      {!isStreaming && completedCount > 0 && (
        <span className="text-xs text-muted-foreground/50 ml-1">
          ({completedCount})
        </span>
      )}
    </div>
  );
}

// Thinking process component - dynamic during streaming, collapsed after
function ThinkingBlock({ thinking, isStreaming, t }: { thinking: string; isStreaming?: boolean; t: (key: string) => string }) {
  // Only expanded by default when streaming
  const [isOpen, setIsOpen] = useState(isStreaming || false);
  const thinkingRef = useRef<HTMLDivElement>(null);

  if (!thinking) return null;

  // Truncate thinking for preview (collapsed state)
  const thinkingPreview = thinking.length > 80 
    ? thinking.slice(0, 80).trim() + '...' 
    : thinking;
  
  // Count thinking lines/chars for display
  const thinkingLines = thinking.split('\n').length;
  const thinkingChars = thinking.length;

  // When streaming, show live view with more content
  if (isStreaming) {
    // Get more lines for live preview
    const lines = thinking.split('\n');
    const lastLines = lines.slice(-15).join('\n');
    
    return (
      <div className="mb-3 rounded-lg overflow-hidden border border-purple-500/30 bg-gradient-to-r from-purple-500/5 to-transparent">
        {/* Header with live indicator */}
        <div className="flex items-center gap-2 px-3 py-2 bg-purple-500/10 border-b border-purple-500/20">
          <span className="text-sm">💭</span>
          <span className="font-medium text-sm text-purple-700 dark:text-purple-300">
            {t('thinkingProcess')}
          </span>
          <span className="flex items-center gap-1.5 ml-auto">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-500 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
            </span>
            <span className="text-xs text-purple-500 animate-pulse">{t('thinking')}...</span>
          </span>
        </div>
        
        {/* Live thinking content - larger view */}
        <div 
          ref={thinkingRef}
          className="px-3 py-2 text-sm text-muted-foreground font-mono leading-relaxed max-h-64 overflow-y-auto"
          style={{ scrollBehavior: 'smooth' }}
        >
          <div className="whitespace-pre-wrap break-words">
            {lastLines}
            <span className="inline-block w-1.5 h-4 bg-purple-500/70 animate-pulse ml-0.5 align-middle" />
          </div>
        </div>
        
        {/* Stats footer */}
        <div className="px-3 py-1 text-xs text-purple-500/60 border-t border-purple-500/10 bg-purple-500/5">
          {thinkingLines} {t('lines')} · {Math.round(thinkingChars / 100) / 10}k {t('chars')}
        </div>
      </div>
    );
  }

  // Completed state - compact collapsible
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="mb-2">
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-2 w-full text-left px-2.5 py-1.5 rounded-md bg-purple-500/5 hover:bg-purple-500/10 transition-colors border border-purple-500/10 group">
          <span className="text-xs opacity-60">💭</span>
          {isOpen ? (
            <span className="text-xs text-purple-600/70 dark:text-purple-400/70 flex-1">
              {t('thinkingProcess')}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/60 flex-1 truncate italic">
              {thinkingPreview}
            </span>
          )}
          <span className="text-xs text-muted-foreground/40 group-hover:text-muted-foreground/60 transition-colors">
            {isOpen ? '▼' : '▶'}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 px-3 py-2 rounded-md bg-purple-500/5 border border-purple-500/10 text-xs text-muted-foreground/80 whitespace-pre-wrap max-h-48 overflow-y-auto font-mono leading-relaxed">
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

// Streaming activity indicator - rich display of what the agent is doing
function StreamingActivity({ message, t }: { message: ChatMessage; t: (key: string) => string }) {
  const extMsg = message as ChatMessage & { currentTool?: string; toolCount?: number; responseLength?: number; lastHeartbeat?: number };
  const currentTool = extMsg.currentTool;
  const tools = message.tool_use || [];
  const completedTools = tools.filter(t => t.result).length;
  const toolName = currentTool || (tools.length > 0 ? tools[tools.length - 1]?.tool : '');
  
  return (
    <div className="flex items-center gap-2">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
      </span>
      <span className="text-sm text-muted-foreground">
        {toolName || t('generating')}
        {tools.length > 0 && <span className="text-xs ml-1 opacity-60">({completedTools}/{tools.length})</span>}
      </span>
    </div>
  );
}

// Message bubble component - Clean Room Style with animations - Responsive
function MessageBubble({ message, t, locale }: { message: ChatMessage; t: (key: string) => string; locale: string }) {
  const isUser = message.role === 'user';
  const isStreaming = message.isStreaming;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3 sm:mb-4 message-bubble`}>
      <div
        className={`max-w-[90%] sm:max-w-[80%] rounded-xl sm:rounded-2xl p-3 sm:p-4 transition-all duration-300 ${
          isUser
            ? 'bg-primary text-primary-foreground shadow-sm hover:shadow-md hover:shadow-primary/20'
            : 'bg-card border border-border/50 shadow-sm hover:shadow-md hover:border-primary/20'
        }`}
      >
        {/* Thinking process */}
        {!isUser && message.thinking && (
          <ThinkingBlock thinking={message.thinking} isStreaming={isStreaming} t={t} />
        )}
        
        {/* Message content - prioritize showing meaningful content */}
        {(() => {
          const hasContent = message.content && message.content.trim().length > 0;
          const hasThinking = message.thinking && message.thinking.trim().length > 0;
          
          // User message - simple display
          if (isUser) {
            return <div className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</div>;
          }
          
          // Has content - show it (main case)
          if (hasContent) {
            return <MarkdownContent content={message.content} className="text-sm" />;
          }
          
          // Streaming with no content yet - show rich activity indicator
          if (isStreaming && !hasThinking) {
            return <StreamingActivity message={message} t={t} />;
          }
          
          // Only thinking, no other content yet
          if (isStreaming && hasThinking && !hasContent) {
            return null; // ThinkingBlock is already shown above
          }
          
          return null;
        })()}
        
        {/* Tool progress - current status only */}
        {!isUser && message.tool_use && message.tool_use.length > 0 && (
          <ToolProgressIndicator 
            tools={message.tool_use as ExtendedTool[]} 
            isStreaming={isStreaming} 
            currentToolName={(message as ChatMessage & { currentTool?: string }).currentTool}
            t={t} 
          />
        )}
        
        {/* Todo list from TodoWrite tool */}
        {!isUser && message.tool_use && (() => {
          const todos = extractLatestTodos(message.tool_use);
          return todos && todos.length > 0 ? (
            <TodoListDisplay todos={todos} t={t} />
          ) : null;
        })()}
        
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
      <CardHeader className="py-2 sm:py-2.5 px-3 sm:px-4 flex-shrink-0 border-b border-border/30">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-xs sm:text-sm font-medium">{t('conversation')}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono truncate opacity-70">
              {session.working_directory.split('/').slice(-2).join('/')}
            </p>
          </div>
          <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
            <Badge variant="secondary" className="text-xs rounded-lg font-normal h-5 px-1.5 sm:px-2 hidden sm:inline-flex">
              {session.model.split('-').slice(0,2).join('-')}
            </Badge>
            <Badge
              variant={session.status === 'active' ? 'default' : 'secondary'}
              className="text-xs rounded-lg font-normal h-5 px-1.5 sm:px-2"
            >
              {session.status}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <Separator className="flex-shrink-0" />
      <CardContent className="flex-1 p-0 flex flex-col min-h-0 overflow-hidden">
        <ScrollArea className="flex-1 min-h-0" ref={scrollAreaRef}>
          <div className="p-2 sm:p-4">
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
                  <MessageBubble key={index} message={message} t={t as (key: string) => string} locale={locale} />
                ))}
                
                {/* Permission request cards */}
                {permissionRequests.map((request) => (
                  <PermissionRequestCard
                    key={request.request_id}
                    request={request}
                    onRespond={respondToPermission}
                    t={t as (key: string) => string}
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
        
        <div className="p-2 sm:p-3 border-t border-border/30 flex-shrink-0 bg-card/50 backdrop-blur-sm">
          <form onSubmit={handleSubmit} className="flex gap-1.5 sm:gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('inputPlaceholder')}
              className="min-h-[40px] sm:min-h-[48px] max-h-[80px] sm:max-h-[100px] resize-none rounded-xl border-border/50 bg-background/80 focus:bg-background transition-all duration-300 input-glow text-sm"
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
