import type {
  Session,
  CreateSessionRequest,
  SendMessageRequest,
  AgentResponse,
  SessionListResponse,
  HistoryResponse,
  StreamChunk,
} from '@/types';

const API_BASE = '/api';

async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
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

  async deleteSession(
    sessionId: string,
    deleteDir = true,
    keepDirectory = false
  ): Promise<void> {
    await fetchApi(`/sessions/${sessionId}?delete=${deleteDir}&keep_directory=${keepDirectory}`, {
      method: 'DELETE',
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
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk> {
    
    const response = await fetch(`${API_BASE}/sessions/${sessionId}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, stream: true }),
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

  // Preview
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
};

export interface PreviewStatus {
  session_id: string;
  status: 'not_started' | 'starting' | 'running' | 'stopped' | 'error';
  url: string | null;  // Proxy URL for public access
  local_url: string | null;  // Direct localhost URL
  port: number | null;
  project_dir: string | null;
  error: string | null;
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
