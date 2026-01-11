import { useState, useCallback, useRef, useEffect } from 'react';
import { api, type PermissionRequest } from '@/lib/api';
import type { Session, ChatMessage, CreateSessionRequest, ToolUse } from '@/types';

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.listSessions();
      setSessions(response.sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  const createSession = useCallback(async (request: CreateSessionRequest = {}) => {
    setLoading(true);
    setError(null);
    try {
      const session = await api.createSession(request);
      setSessions((prev) => [...prev, session]);
      return session;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteSession = useCallback(async (sessionId: string) => {
    setLoading(true);
    setError(null);
    try {
      await api.deleteSession(sessionId, true);
      setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
      // Clean up message cache
      messageCache.delete(sessionId);
      streamingState.delete(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete session');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    sessions,
    loading,
    error,
    fetchSessions,
    createSession,
    deleteSession,
  };
}

// Global message cache - persists across session switches
const messageCache = new Map<string, ChatMessage[]>();
const streamingState = new Map<string, boolean>();
const abortControllers = new Map<string, AbortController>();
const pendingPermissions = new Map<string, PermissionRequest[]>();

// Helper to update the last assistant message immutably
function updateLastAssistantMessage(
  messages: ChatMessage[],
  updater: (msg: ChatMessage) => Partial<ChatMessage>
): ChatMessage[] {
  if (messages.length === 0) return messages;
  
  const lastIndex = messages.length - 1;
  const lastMessage = messages[lastIndex];
  
  if (lastMessage.role !== 'assistant') return messages;
  
  const updates = updater(lastMessage);
  const newMessages = [...messages];
  newMessages[lastIndex] = { ...lastMessage, ...updates };
  
  return newMessages;
}

export function useChat(sessionId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionRequests, setPermissionRequests] = useState<PermissionRequest[]>([]);
  
  // Sync messages with global cache
  const syncToCache = useCallback((newMessages: ChatMessage[]) => {
    if (sessionId) {
      messageCache.set(sessionId, newMessages);
    }
    setMessages(newMessages);
  }, [sessionId]);
  
  // Sync permission requests with global cache
  const syncPermissions = useCallback((requests: PermissionRequest[]) => {
    if (sessionId) {
      pendingPermissions.set(sessionId, requests);
    }
    setPermissionRequests(requests);
  }, [sessionId]);

  // Load from cache or fetch history when session changes
  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      setStreaming(false);
      return;
    }
    
    // Check if this session is currently streaming
    const isSessionStreaming = streamingState.get(sessionId) || false;
    setStreaming(isSessionStreaming);
    
    // Try to load from cache first
    const cached = messageCache.get(sessionId);
    if (cached && cached.length > 0) {
      setMessages(cached);
    } else {
      // Fetch from server
      setLoading(true);
      api.getHistory(sessionId)
        .then((response) => {
          syncToCache(response.messages);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to fetch history');
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [sessionId, syncToCache]);

  const fetchHistory = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.getHistory(sessionId);
      syncToCache(response.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch history');
    } finally {
      setLoading(false);
    }
  }, [sessionId, syncToCache]);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!sessionId) return;
      setLoading(true);
      setError(null);

      const userMessage: ChatMessage = {
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
      };
      
      const newMessages = [...messages, userMessage];
      syncToCache(newMessages);

      try {
        const response = await api.sendMessage(sessionId, { message: content });
        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: response.message,
          timestamp: new Date().toISOString(),
          tool_use: response.tool_results,
        };
        syncToCache([...newMessages, assistantMessage]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to send message');
        syncToCache(messages); // Revert
      } finally {
        setLoading(false);
      }
    },
    [sessionId, messages, syncToCache]
  );

  const sendMessageStream = useCallback(
    async (content: string) => {
      if (!sessionId) return;
      
      // Abort any existing stream for this session
      const existingController = abortControllers.get(sessionId);
      if (existingController) {
        existingController.abort();
      }
      
      const abortController = new AbortController();
      abortControllers.set(sessionId, abortController);
      
      setStreaming(true);
      streamingState.set(sessionId, true);
      setError(null);

      // Add user message
      const userMessage: ChatMessage = {
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
      };
      
      // Add user message and placeholder for assistant
      const initialMessages: ChatMessage[] = [
        ...messages,
        userMessage,
        {
          role: 'assistant',
          content: '',
          timestamp: new Date().toISOString(),
          thinking: '',
          tool_use: [],
          isStreaming: true,
        },
      ];
      syncToCache(initialMessages);

      try {
        for await (const chunk of api.streamMessage(sessionId, content, abortController.signal)) {
          const chunkType = chunk.type;
          
          // Get current messages from cache (in case user switched and came back)
          const currentMessages = messageCache.get(sessionId) || [];
          
          // Handle text delta - character level streaming
          if (chunkType === 'text_delta') {
            const textDelta = chunk.content as string;
            const updated = updateLastAssistantMessage(currentMessages, (msg) => ({
              content: (msg.content || '') + textDelta,
            }));
            syncToCache(updated);
          }
          
          // Handle thinking delta
          else if (chunkType === 'thinking_delta') {
            const thinkingDelta = chunk.content as string;
            const updated = updateLastAssistantMessage(currentMessages, (msg) => ({
              thinking: (msg.thinking || '') + thinkingDelta,
            }));
            syncToCache(updated);
          }
          
          // Handle thinking start
          else if (chunkType === 'thinking_start') {
            const updated = updateLastAssistantMessage(currentMessages, () => ({
              thinking: '',
            }));
            syncToCache(updated);
          }
          
          // Handle tool use start
          else if (chunkType === 'tool_use_start') {
            const toolInfo = chunk.content as { tool: string; id: string };
            const updated = updateLastAssistantMessage(currentMessages, (msg) => {
              const tools = [...(msg.tool_use || [])];
              tools.push({
                tool: toolInfo.tool,
                input: {},
                id: toolInfo.id,
              } as ToolUse & { id: string });
              return { tool_use: tools };
            });
            syncToCache(updated);
          }
          
          // Handle tool result
          else if (chunkType === 'tool_result') {
            const resultContent = chunk.content as string;
            const updated = updateLastAssistantMessage(currentMessages, (msg) => {
              if (!msg.tool_use || msg.tool_use.length === 0) return {};
              const tools = [...msg.tool_use];
              const lastTool = { ...tools[tools.length - 1] };
              lastTool.result = resultContent;
              tools[tools.length - 1] = lastTool;
              return { tool_use: tools };
            });
            syncToCache(updated);
          }
          
          // Handle legacy text type (complete replacement)
          else if (chunkType === 'text') {
            const text = chunk.content as string;
            const updated = updateLastAssistantMessage(currentMessages, () => ({
              content: text,
            }));
            syncToCache(updated);
          }
          
          // Handle tool_use (legacy)
          else if (chunkType === 'tool_use') {
            const toolInfo = chunk.content as ToolUse;
            const updated = updateLastAssistantMessage(currentMessages, (msg) => ({
              tool_use: [...(msg.tool_use || []), toolInfo],
            }));
            syncToCache(updated);
          }
          
          // Handle done - just mark as not streaming, don't update content
          else if (chunkType === 'done') {
            const updated = updateLastAssistantMessage(currentMessages, () => ({
              isStreaming: false,
            }));
            syncToCache(updated);
          }
          
          // Handle error
          else if (chunkType === 'error') {
            setError(chunk.content as string);
          }
          
          // Handle permission request - requires user approval
          else if (chunkType === 'permission_request') {
            const request = chunk as unknown as PermissionRequest & { type: string; session_id: string };
            const currentPermissions = pendingPermissions.get(sessionId) || [];
            syncPermissions([...currentPermissions, {
              request_id: request.request_id,
              tool_name: request.tool_name,
              tool_input: request.tool_input,
              suggestions: request.suggestions || [],
              created_at: new Date().toISOString(),
            }]);
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : 'Failed to send message');
          // Revert on error
          const currentMessages = messageCache.get(sessionId) || [];
          if (currentMessages.length >= 2) {
            syncToCache(currentMessages.slice(0, -2));
          }
        }
      } finally {
        setStreaming(false);
        streamingState.set(sessionId, false);
        abortControllers.delete(sessionId);
      }
    },
    [sessionId, messages, syncToCache]
  );

  const stopStreaming = useCallback(() => {
    if (!sessionId) return;
    
    const controller = abortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      abortControllers.delete(sessionId);
    }
    
    setStreaming(false);
    streamingState.set(sessionId, false);
    
    const currentMessages = messageCache.get(sessionId) || [];
    const updated = updateLastAssistantMessage(currentMessages, () => ({
      isStreaming: false,
    }));
    syncToCache(updated);
  }, [sessionId, syncToCache]);

  const clearMessages = useCallback(() => {
    if (sessionId) {
      messageCache.delete(sessionId);
    }
    setMessages([]);
  }, [sessionId]);
  
  const respondToPermission = useCallback(async (
    requestId: string,
    decision: 'allow' | 'deny'
  ) => {
    if (!sessionId) return;
    
    try {
      await api.respondToPermission(sessionId, requestId, decision);
      
      // Remove from pending list
      const current = pendingPermissions.get(sessionId) || [];
      syncPermissions(current.filter(r => r.request_id !== requestId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to respond to permission');
    }
  }, [sessionId, syncPermissions]);

  return {
    messages,
    loading,
    streaming,
    error,
    permissionRequests,
    fetchHistory,
    sendMessage,
    sendMessageStream,
    stopStreaming,
    clearMessages,
    respondToPermission,
  };
}
