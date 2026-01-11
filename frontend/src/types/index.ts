export interface Session {
  session_id: string;
  working_directory: string;
  status: 'active' | 'idle' | 'busy' | 'closed';
  created_at: string;
  last_activity: string;
  message_count: number;
  model: string;
}

export interface CreateSessionRequest {
  system_prompt?: string;
  allowed_tools?: string[];
  model?: string;
}

export interface ToolUse {
  tool: string;
  input: Record<string, unknown>;
  result?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  tool_use?: ToolUse[];
  thinking?: string;
  isStreaming?: boolean;
}

export interface StreamChunk {
  type: 'text' | 'text_delta' | 'thinking' | 'thinking_delta' | 'thinking_start' | 
        'tool_use' | 'tool_use_start' | 'tool_use_end' | 'tool_input_delta' |
        'tool_result' | 'done' | 'error';
  content: string | ToolUse | { tool: string; id: string } | { id: string };
  session_id: string;
  is_complete?: boolean;
  tool_id?: string;
}

export interface SendMessageRequest {
  message: string;
  stream?: boolean;
}

export interface AgentResponse {
  session_id: string;
  message: string;
  tool_results?: ToolUse[];
  is_complete: boolean;
}

export interface SessionListResponse {
  sessions: Session[];
  total: number;
}

export interface HistoryResponse {
  session_id: string;
  messages: ChatMessage[];
  total: number;
  limit: number;
  offset: number;
}
