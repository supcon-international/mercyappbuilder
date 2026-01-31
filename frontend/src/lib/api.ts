import type {
  Session,
  CreateSessionRequest,
  UpdateSessionRequest,
  SendMessageRequest,
  AgentResponse,
  SessionListResponse,
  HistoryResponse,
  StreamChunk,
  UnsData,
  SystemStatusResponse,
} from '@/types';

const API_BASE = '/api';
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_RETRIES = 2;

// Custom error class for API errors
export class ApiError extends Error {
  status: number;
  isRetryable: boolean;
  
  constructor(message: string, status: number, isRetryable: boolean = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.isRetryable = isRetryable;
  }
}

async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit & { timeout?: number; retries?: number }
): Promise<T> {
  const { timeout = DEFAULT_TIMEOUT, retries = MAX_RETRIES, ...fetchOptions } = options || {};
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        headers: {
          'Content-Type': 'application/json',
          ...fetchOptions?.headers,
        },
        ...fetchOptions,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const isRetryable = response.status >= 500 || response.status === 429;
        throw new ApiError(
          error.detail || `HTTP ${response.status}`,
          response.status,
          isRetryable
        );
      }

      return response.json();
    } catch (err) {
      clearTimeout(timeoutId);
      
      if (err instanceof ApiError) {
        if (!err.isRetryable || attempt === retries) {
          throw err;
        }
        lastError = err;
      } else if (err instanceof Error) {
        if (err.name === 'AbortError') {
          throw new ApiError('Request timeout', 408, true);
        }
        // Network errors are retryable
        if (attempt === retries) {
          throw new ApiError(err.message || 'Network error', 0, false);
        }
        lastError = err;
      }
      
      // Wait before retry (exponential backoff)
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 500));
      }
    }
  }
  
  throw lastError || new ApiError('Unknown error', 0, false);
}

export const api = {
  // Sessions
  async createSession(request: CreateSessionRequest = {}): Promise<Session> {
    return fetchApi<Session>('/sessions', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  async listSessions(includeClosed = false): Promise<SessionListResponse> {
    return fetchApi<SessionListResponse>(
      `/sessions?include_closed=${includeClosed}`
    );
  },

  async getSession(sessionId: string): Promise<Session> {
    return fetchApi<Session>(`/sessions/${sessionId}`);
  },

  async getUns(sessionId: string): Promise<UnsData> {
    return fetchApi<UnsData>(`/sessions/${sessionId}/uns`);
  },

  async deleteSession(
    sessionId: string,
    deleteDir = true,
    keepDirectory = false
  ): Promise<void> {
    await fetchApi(`/sessions/${sessionId}?delete=${deleteDir}&keep_directory=${keepDirectory}`, {
      method: 'DELETE',
    });
  },

  async updateSession(
    sessionId: string,
    request: UpdateSessionRequest
  ): Promise<Session> {
    return fetchApi<Session>(`/sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify(request),
    });
  },

  // Chat
  async sendMessage(
    sessionId: string,
    request: SendMessageRequest
  ): Promise<AgentResponse> {
    return fetchApi<AgentResponse>(`/sessions/${sessionId}/chat`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  // Streaming chat - v3
  async *streamMessage(
    sessionId: string,
    message: string,
    context?: string | null,
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk> {
    
    const response = await fetch(`${API_BASE}/sessions/${sessionId}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, stream: true, context: context || undefined }),
      signal,
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              yield data;
            } catch (e) {
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },

  // History
  async getHistory(
    sessionId: string,
    limit = 50,
    offset = 0
  ): Promise<HistoryResponse> {
    return fetchApi<HistoryResponse>(
      `/sessions/${sessionId}/history?limit=${limit}&offset=${offset}`
    );
  },

  async clearHistory(sessionId: string): Promise<void> {
    await fetchApi(`/sessions/${sessionId}/history`, {
      method: 'DELETE',
    });
  },

  // Health
  async healthCheck(): Promise<{ status: string; active_sessions: number }> {
    return fetchApi('/health');
  },

  async getSystemStatus(): Promise<SystemStatusResponse> {
    return fetchApi<SystemStatusResponse>('/system/status');
  },

  // Permissions
  async getPendingPermissions(sessionId: string): Promise<PendingPermissionsResponse> {
    return fetchApi<PendingPermissionsResponse>(`/sessions/${sessionId}/permissions`);
  },

  async respondToPermission(
    sessionId: string,
    requestId: string,
    decision: 'allow' | 'deny',
    updatedInput?: Record<string, unknown>
  ): Promise<PermissionResponse> {
    const params = new URLSearchParams({ decision });
    return fetchApi<PermissionResponse>(
      `/sessions/${sessionId}/permissions/${requestId}?${params.toString()}`,
      {
        method: 'POST',
        body: updatedInput ? JSON.stringify(updatedInput) : undefined,
      }
    );
  },

  // View (build mode only)
  async startView(sessionId: string): Promise<ViewStatus> {
    return fetchApi<ViewStatus>(`/sessions/${sessionId}/view/start`, {
      method: 'POST',
    });
  },

  async stopView(sessionId: string): Promise<{ session_id: string; stopped: boolean }> {
    return fetchApi(`/sessions/${sessionId}/view/stop`, {
      method: 'POST',
    });
  },

  async getViewStatus(sessionId: string): Promise<ViewStatus> {
    return fetchApi<ViewStatus>(`/sessions/${sessionId}/view/status`);
  },

  // Preview (dev mode with HMR)
  async startPreview(sessionId: string): Promise<PreviewStatus> {
    return fetchApi<PreviewStatus>(`/sessions/${sessionId}/preview/start`, {
      method: 'POST',
    });
  },

  async stopPreview(sessionId: string): Promise<{ session_id: string; stopped: boolean }> {
    return fetchApi(`/sessions/${sessionId}/preview/stop`, {
      method: 'POST',
    });
  },

  async getPreviewStatus(sessionId: string): Promise<PreviewStatus> {
    return fetchApi<PreviewStatus>(`/sessions/${sessionId}/preview/status`);
  },

  // Flow (shared Node-RED)
  async startFlow(sessionId?: string | null): Promise<FlowStatus> {
    const endpoint = sessionId ? `/sessions/${sessionId}/flow/start` : `/flow/start`;
    return fetchApi<FlowStatus>(endpoint, {
      method: 'POST',
    });
  },

  async getFlowStatus(): Promise<FlowStatus> {
    return fetchApi<FlowStatus>(`/flow/status`);
  },
};

export interface ViewStatus {
  session_id: string;
  status: 'not_started' | 'building' | 'running' | 'stopped' | 'error';
  url: string | null;  // Proxy URL for public access
  local_url: string | null;  // Direct localhost URL
  port: number | null;
  project_dir: string | null;
  error: string | null;
  package_ready?: boolean;
  package_error?: string | null;
}

export interface PreviewStatus {
  session_id: string;
  status: 'not_started' | 'starting' | 'running' | 'stopped' | 'error';
  url: string | null;  // Proxy URL for public access
  local_url: string | null;  // Direct localhost URL
  port: number | null;
  project_dir: string | null;
  error: string | null;
}

export interface FlowStatus {
  status: 'not_started' | 'starting' | 'running' | 'stopped' | 'error';
  url: string | null;
  local_url: string | null;
  port: number | null;
  error: string | null;
  managed: boolean;
}

export interface PermissionRequest {
  request_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  suggestions: string[];
  created_at: string;
}

export interface PendingPermissionsResponse {
  session_id: string;
  pending_requests: PermissionRequest[];
  count: number;
}

export interface PermissionResponse {
  session_id: string;
  request_id: string;
  decision: 'allow' | 'deny';
  success: boolean;
}
