export interface Session {
  session_id: string;
  working_directory: string;
  status: 'active' | 'idle' | 'busy' | 'closed';
  created_at: string;
  last_activity: string;
  message_count: number;
  model: string;
  display_name?: string | null;
  claude_md_loaded?: boolean;
}

export interface CreateSessionRequest {
  system_prompt?: string;
  allowed_tools?: string[];
  model?: string;
  display_name?: string | null;
}

export interface UpdateSessionRequest {
  display_name?: string | null;
}

export interface ToolUse {
  tool: string;
  input: Record<string, unknown>;
  result?: string;
  id?: string;
  inputRaw?: string;
  status?: 'running' | 'done';
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  tool_use?: ToolUse[];
  thinking?: string;
  isStreaming?: boolean;
  // Streaming metadata
  currentTool?: string;
  lastHeartbeat?: number;
  responseLength?: number;
  toolCount?: number;
}

export interface StreamChunk {
  type: 'text' | 'text_delta' | 'thinking' | 'thinking_delta' | 'thinking_start' | 
        'tool_use' | 'tool_use_start' | 'tool_use_end' | 'tool_input_delta' |
        'tool_result' | 'done' | 'error' | 'permission_request' | 'heartbeat';
  content: string | ToolUse | { tool: string; id: string } | { id: string };
  session_id: string;
  is_complete?: boolean;
  tool_id?: string;
  // Heartbeat fields
  response_length?: number;
  tool_count?: number;
}

export interface SendMessageRequest {
  message: string;
  stream?: boolean;
  context?: string | null;
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

export interface UnsTopic {
  id: string;
  path: string;
  type: 'metric' | 'state' | 'action' | 'info' | string;
  label?: string;
  payloadSchema?: Record<string, unknown>;
}

export interface UnsData {
  version?: string;
  site?: string;
  topics: UnsTopic[];
}

export interface SessionResourceUsage {
  session_id: string;
  display_name?: string | null;
  status: 'active' | 'idle' | 'busy' | 'closed';
  cpu_percent: number;
  memory_percent: number;
  memory_bytes: number;
  disk_percent: number;
  disk_bytes: number;
  process_count: number;
}

export interface TotalResourceUsage {
  cpu_percent: number;
  memory_percent: number;
  memory_used_bytes: number;
  memory_total_bytes: number;
  disk_percent: number;
  disk_used_bytes: number;
  disk_total_bytes: number;
}

export interface SystemStatusResponse {
  timestamp: string;
  total: TotalResourceUsage;
  sessions: SessionResourceUsage[];
}
