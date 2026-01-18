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
    sessionName: '会话名称',
    sessionNamePlaceholder: '给会话起个名字（可选）',
    renameSession: '修改会话名称',
    editName: '编辑',
    save: '保存',
    
    // Create Session Dialog
    createSession: '创建新会话',
    createSessionDesc: '每个会话将自动创建独立的工作目录',
    model: '模型',
    selectModel: '选择模型',
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
    executing: '执行中',
    completed: '已完成',
    toolCalls: '个工具调用',
    result: '结果',
    taskProgress: '任务进度',
    elapsedTime: '耗时',
    
    // Thinking
    thinkingProcess: '思考过程',
    thinking: '思考中',
    lines: '行',
    chars: '字符',
    
    // View Panel
    view: '视图',
    hideView: '隐藏视图',
    showView: '视图',
    hideFlow: '隐藏 Flow',
    showFlow: 'Flow',
    building: '构建中',
    buildingHint: '正在构建项目...',
    build: '构建',
    retry: '重试',
    viewProject: '查看项目',
    viewHint: '点击构建按钮构建并查看项目',
    flow: 'Flow',
    flowTab: 'Flow',
    flowTitle: 'Flow 编排',
    flowHint: '点击启动以打开共享 Node-RED Flow 编辑器',
    flowStart: '启动 Flow',
    flowStarting: 'Flow 启动中...',
    selectSessionView: '选择会话查看',
    running: '运行中',
    starting: '启动中...',
    stopped: '已停止',
    error: '错误',
    notStarted: '未启动',
    start: '启动',
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
    edit: '编辑',
    editing: '编辑中',
    enterEditMode: '进入编辑模式',
    exitEditMode: '退出编辑模式',
    clickToSelectComponent: '点击页面中的组件以选择并进入对话修改',
    selectedComponent: '已选组件上下文将附加到下一条消息',
    clear: '清除',
    viewTab: '预览',
    unsLoading: '正在加载 UNS 数据...',
    unsMissing: '未找到 uns.json',
    unsSchema: 'Schema',
    unsSelectHint: '从左侧选择一个节点查看 schema',
    agentRunning: 'Agent 仍在执行中',
    refreshHistory: '刷新历史',
    collapseSidebar: '收起侧边栏',
    expandSidebar: '展开侧边栏',

    // Wizard
    wizardTitle: 'MES 应用构建向导',
    wizardSubtitle: '按步骤补全需求，也可直接在下方输入框发送以跳过',
    wizardSkip: '跳过向导',
    wizardIndustryTitle: '行业 & 流程',
    wizardIndustryHint: '所属行业与关键流程、痛点或场景',
    wizardIndustryPlaceholder: '例：离散制造；设备点检、工单流转、质检放行...',
    wizardGoalTitle: '场景目标 / KPI',
    wizardGoalHint: '你要解决什么业务问题？',
    wizardGoalPlaceholder: '例：提升 OEE、降低停机、提高良率...',
    wizardRolesTitle: '角色与任务',
    wizardRolesHint: '主要使用者是谁？他们需要完成哪些任务？',
    wizardRolesPlaceholder: '例：操作员、班组长、工艺工程师...',
    wizardModulesTitle: '模块清单',
    wizardModulesHint: '需要哪些功能模块？',
    wizardModulesPlaceholder: '例：OEE、工单、维保、追溯、SPC...',
    wizardDataTitle: '核心数据对象',
    wizardDataHint: '关键对象、字段和关系',
    wizardDataPlaceholder: '例：设备、工单、批次、报警、参数...',
    wizardFlowTitle: '流程 / 状态机',
    wizardFlowHint: '关键流程的状态流转与规则',
    wizardFlowPlaceholder: '例：工单 -> 生产 -> 完工 -> 质检...',
    wizardUnsTitle: 'UNS 主题树',
    wizardUnsHint: '按 v1/site/line/... 描述主题路径',
    wizardUnsPlaceholder: '例：v1/SG01/Cellar/Fermenter01/Metrics/tempC',
    wizardOptional: '可选',
    wizardBack: '上一步',
    wizardNext: '下一步',
    wizardSend: '生成并发送',
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
    sessionName: 'Session Name',
    sessionNamePlaceholder: 'Give the session a name (optional)',
    renameSession: 'Rename Session',
    editName: 'Edit',
    save: 'Save',
    
    // Create Session Dialog
    createSession: 'Create New Session',
    createSessionDesc: 'Each session will have its own working directory',
    model: 'Model',
    selectModel: 'Select Model',
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
    executing: 'Executing',
    completed: 'Completed',
    toolCalls: 'tool calls',
    result: 'Result',
    taskProgress: 'Task Progress',
    elapsedTime: 'Elapsed',
    
    // Thinking
    thinkingProcess: 'Thinking Process',
    thinking: 'Thinking',
    lines: 'lines',
    chars: 'chars',
    
    // View Panel
    view: 'View',
    hideView: 'Hide View',
    showView: 'View',
    hideFlow: 'Hide Flow',
    showFlow: 'Flow',
    building: 'Building',
    buildingHint: 'Building project...',
    build: 'Build',
    retry: 'Retry',
    viewProject: 'View Project',
    viewHint: 'Click Build to build and view project',
    flow: 'Flow',
    flowTab: 'Flow',
    flowTitle: 'Flow Editor',
    flowHint: 'Start to open the shared Node-RED Flow editor',
    flowStart: 'Start Flow',
    flowStarting: 'Starting Flow...',
    selectSessionView: 'Select session to view',
    running: 'Running',
    starting: 'Starting...',
    stopped: 'Stopped',
    error: 'Error',
    notStarted: 'Not Started',
    start: 'Start',
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
    edit: 'Edit',
    editing: 'Editing',
    enterEditMode: 'Enter edit mode',
    exitEditMode: 'Exit edit mode',
    clickToSelectComponent: 'Click a component in the view to edit it via chat',
    selectedComponent: 'Selected component context will be added to your next message',
    clear: 'Clear',
    viewTab: 'Preview',
    unsLoading: 'Loading UNS data...',
    unsMissing: 'uns.json not found',
    unsSchema: 'Schema',
    unsSelectHint: 'Select a node from the left to view schema',
    agentRunning: 'Agent is still running',
    refreshHistory: 'Refresh history',
    collapseSidebar: 'Collapse sidebar',
    expandSidebar: 'Expand sidebar',

    // Wizard
    wizardTitle: 'MES App Wizard',
    wizardSubtitle: 'Fill in steps, or send below to skip',
    wizardSkip: 'Skip wizard',
    wizardIndustryTitle: 'Industry & Process',
    wizardIndustryHint: 'Industry, key process, and pain points',
    wizardIndustryPlaceholder: 'e.g. discrete manufacturing; inspection → work order → QA release',
    wizardGoalTitle: 'Goal / KPI',
    wizardGoalHint: 'What business outcome are you targeting?',
    wizardGoalPlaceholder: 'e.g. improve OEE, reduce downtime, increase yield',
    wizardRolesTitle: 'Roles & Tasks',
    wizardRolesHint: 'Who are the users and what do they do?',
    wizardRolesPlaceholder: 'e.g. operators, supervisors, process engineers',
    wizardModulesTitle: 'Modules',
    wizardModulesHint: 'Which functional modules are needed?',
    wizardModulesPlaceholder: 'e.g. OEE, work orders, maintenance, traceability, SPC',
    wizardDataTitle: 'Core Data Objects',
    wizardDataHint: 'Key entities, fields, relationships',
    wizardDataPlaceholder: 'e.g. equipment, work orders, batches, alarms, parameters',
    wizardFlowTitle: 'Flow / State Machine',
    wizardFlowHint: 'Key process states and transitions',
    wizardFlowPlaceholder: 'e.g. order -> production -> complete -> QA',
    wizardUnsTitle: 'UNS Topics',
    wizardUnsHint: 'Describe UNS topic paths',
    wizardUnsPlaceholder: 'e.g. v1/SG01/Cellar/Fermenter01/Metrics/tempC',
    wizardOptional: 'Optional',
    wizardBack: 'Back',
    wizardNext: 'Next',
    wizardSend: 'Generate & Send',
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
