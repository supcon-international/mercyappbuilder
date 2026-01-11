// Internationalization (i18n) support

export type Locale = 'zh' | 'en';

export const translations = {
  zh: {
    // Header
    appName: 'Tier0 Appbuilder',
    appSubtitle: 'AI Agent 工作台',
    
    // Session List
    sessions: '会话',
    newSession: '+ 新建',
    noSessions: '暂无会话',
    clickToCreate: '点击上方新建开始',
    messages: '条消息',
    
    // Create Session Dialog
    createSession: '创建新会话',
    createSessionDesc: '每个会话将自动创建独立的工作目录',
    model: '模型',
    systemPrompt: '系统提示词',
    systemPromptPlaceholder: '基于 claude.md 完成应用构建',
    defaultSystemPrompt: '基于 claude.md 完成应用构建',
    cancel: '取消',
    create: '创建',
    creating: '创建中...',
    deleteConfirm: '确定要删除此会话吗？工作目录也会被删除。',
    
    // Chat Panel
    conversation: '对话',
    startNewChat: '开始新的对话',
    agentWorkDir: 'Agent 将在此会话的工作目录中操作',
    selectSession: '选择一个会话开始',
    orCreateNew: '或创建新会话',
    inputPlaceholder: '输入消息...',
    send: '发送',
    stop: '停止',
    enterToSend: 'Enter 发送 · Shift+Enter 换行',
    generating: '生成中...',
    streaming: '传输中',
    
    // Tool Progress
    executing: '执行中...',
    completed: '已完成',
    toolCalls: '个工具调用',
    result: '结果',
    
    // Thinking
    thinkingProcess: '思考过程',
    
    // Preview Panel
    preview: '预览',
    hidePreview: '隐藏预览',
    showPreview: '预览',
    running: '运行中',
    starting: '启动中...',
    stopped: '已停止',
    error: '错误',
    notStarted: '未启动',
    start: '启动',
    previewProject: '预览项目',
    previewHint: '点击启动按钮预览 web/ 目录下的项目',
    selectSessionPreview: '选择会话预览',
    installingDeps: '正在安装依赖并启动服务器',
    
    // Language
    language: '语言',
    chinese: '中文',
    english: 'English',
    
    // Permissions
    permissionRequired: '需要批准',
    tool: '工具',
    parameters: '参数',
    suggestions: '建议',
    approve: '批准',
    deny: '拒绝',
    permissionPending: '等待批准...',
  },
  en: {
    // Header
    appName: 'Tier0 Appbuilder',
    appSubtitle: 'AI Agent Workspace',
    
    // Session List
    sessions: 'Sessions',
    newSession: '+ New',
    noSessions: 'No sessions',
    clickToCreate: 'Click above to create one',
    messages: 'messages',
    
    // Create Session Dialog
    createSession: 'Create New Session',
    createSessionDesc: 'Each session will have its own working directory',
    model: 'Model',
    systemPrompt: 'System Prompt',
    systemPromptPlaceholder: 'Build applications based on claude.md',
    defaultSystemPrompt: 'Build applications based on claude.md',
    cancel: 'Cancel',
    create: 'Create',
    creating: 'Creating...',
    deleteConfirm: 'Are you sure you want to delete this session? The working directory will also be deleted.',
    
    // Chat Panel
    conversation: 'Conversation',
    startNewChat: 'Start a new conversation',
    agentWorkDir: 'Agent will operate in this session\'s working directory',
    selectSession: 'Select a session to start',
    orCreateNew: 'or create a new one',
    inputPlaceholder: 'Type a message...',
    send: 'Send',
    stop: 'Stop',
    enterToSend: 'Enter to send · Shift+Enter for new line',
    generating: 'Generating...',
    streaming: 'Streaming',
    
    // Tool Progress
    executing: 'Executing...',
    completed: 'Completed',
    toolCalls: 'tool calls',
    result: 'Result',
    
    // Thinking
    thinkingProcess: 'Thinking Process',
    
    // Preview Panel
    preview: 'Preview',
    hidePreview: 'Hide Preview',
    showPreview: 'Preview',
    running: 'Running',
    starting: 'Starting...',
    stopped: 'Stopped',
    error: 'Error',
    notStarted: 'Not Started',
    start: 'Start',
    previewProject: 'Preview Project',
    previewHint: 'Click Start to preview the web/ directory project',
    selectSessionPreview: 'Select session to preview',
    installingDeps: 'Installing dependencies and starting server',
    
    // Language
    language: 'Language',
    chinese: '中文',
    english: 'English',
    
    // Permissions
    permissionRequired: 'Approval Required',
    tool: 'Tool',
    parameters: 'Parameters',
    suggestions: 'Suggestions',
    approve: 'Approve',
    deny: 'Deny',
    permissionPending: 'Waiting for approval...',
  },
} as const;

export type TranslationKey = keyof typeof translations.zh;

// Get browser default language
export function getDefaultLocale(): Locale {
  const stored = localStorage.getItem('locale');
  if (stored === 'zh' || stored === 'en') {
    return stored;
  }
  const browserLang = navigator.language.toLowerCase();
  return browserLang.startsWith('zh') ? 'zh' : 'en';
}

export function setLocale(locale: Locale) {
  localStorage.setItem('locale', locale);
}
