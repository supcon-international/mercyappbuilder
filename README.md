# Tier0 Appbuilder

基于 Claude Agent SDK 的 AI 应用构建器，支持多 Session、流式响应、实时预览。

## 特性

- **多模型支持**: Claude Opus 4.5/4、Sonnet 4.5/4、Haiku 4.5
- **流式响应**: SSE 实时输出，思考过程可视化，工具调用状态展示
- **多 Session**: 独立工作目录，隔离的对话历史
- **实时预览**: Preview (HMR 热更新) 和 Production (构建模式) 两种预览方式
- **Flow 编排**: 共享 Node-RED 实例，自动导入 Session 的 flow.json
- **UNS 视图**: Appbuilder View 内展示 UNS.json 的树形结构与 Schema
- **SQLite 持久化**: 会话和消息持久化，重启不丢失
- **国际化**: 中英文切换
- **错误恢复**: API 重试、错误边界、断线恢复

## 架构设计

### 组件分层

- **前端 (React + Vite + Shadcn)**: 会话管理、聊天 UI、流式输出与工具调用可视化、View/Flow 嵌入。
- **后端 (FastAPI)**: API、SSE、WebSocket 代理、会话管理、Preview/View/Flow 进程编排。
- **Agent 执行器 (Claude Agent SDK)**: 在 Session 目录内执行工具与文件操作，支持流式输出与权限回调。
- **Session 存储 (SQLite + 文件系统)**: `.sessions/` 保存工作目录与 `sessions.db`，支持重启恢复。
- **Flow 服务 (Node-RED)**: 共享实例，`/flow` 下的编辑器与 API 统一代理。

### 数据与控制流

1. 前端通过 `POST /sessions` 创建会话，后端生成独立工作目录。
2. 聊天请求走 `/sessions/{id}/chat/stream`（SSE），由 Agent 执行器调用 Claude SDK。
3. 会话状态与消息写入 `.sessions/sessions.db`，工作产物写入会话目录。
4. 若检测到 Web 项目，后端可启动 Preview/View，并通过 `/preview/{id}`、`/view/{id}` 统一代理访问。
5. 若存在 `flow.json`，自动导入共享 Node-RED，并通过 `/flow/*` 访问编辑器与 API。

## 快速开始

### 生产模式（推荐）

```bash
# 安装依赖
uv sync
npm install                                      # Node-RED 本地安装
cd frontend && npm install && npm run build && cd ..

# 启动服务（需要非 root 用户以启用 bypassPermissions）
sudo -u appbuilder .venv/bin/python -m uvicorn src.agent_backend.main:app --host 0.0.0.0 --port 8000
```

访问 http://localhost:8000

### 开发模式

```bash
# 后端
uv run uvicorn src.agent_backend.main:app --host 0.0.0.0 --port 8000 --reload

# 前端（另一个终端）
cd frontend && npm run dev
```

开发模式访问 http://localhost:5173

## 端口

| 服务 | 端口 | 说明 |
|------|------|------|
| API + 前端 | 8000 | FastAPI，同时服务静态前端和 API |
| Preview | 5001-5100 | 动态分配，Vite Dev Server (HMR 热更新) |
| Production View | 4001-4100 | 动态分配，构建后的静态文件预览 |
| Flow | 1880 | 共享 Node-RED 实例（通过 `/flow/*` 代理） |

## 网络结构

所有外部访问统一走 `:8000`，后端在同端口代理内部服务，便于公网穿透与域名接入。

```
Browser
  └─ HTTP(S) :8000
      ├─ /api/*, /sessions/* → FastAPI (会话/聊天/SSE)
      ├─ /preview/{session_id}/* → Vite Dev Server :5001-5100 (HMR wss)
      ├─ /view/{session_id}/* → Build 静态服务器 :4001-4100
      └─ /flow/* → Node-RED :1880 (编辑器 + /flow/api)
```

要点说明：
- **HMR**: Preview 会注入 `VITE_BASE=/preview/{session_id}/`，前端通过 `wss` 与 HMR 通道通信。
- **代理路径**: `/preview/{id}`、`/view/{id}`、`/flow/*` 均由后端反向代理到本地端口。

## 公网访问（Tunnel）

只需穿透 **8000 端口**。后端会：
- 直接服务前端静态文件
- 处理 `/api/*` 请求
- 代理 `/view/{session_id}/*` 到对应 View 服务器
- 代理 `/flow/*` 到共享 Node-RED 实例

## API

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/sessions` | 创建 Session |
| GET | `/sessions` | 列出 Sessions |
| DELETE | `/sessions/{id}?delete=true` | 删除 Session |
| POST | `/sessions/{id}/chat/stream` | 发送消息（流式）|
| GET | `/sessions/{id}/history` | 获取历史 |
| POST | `/sessions/{id}/preview/start` | 启动 Preview (Dev Server + HMR) |
| POST | `/sessions/{id}/preview/stop` | 停止 Preview |
| GET | `/sessions/{id}/preview/status` | Preview 状态 |
| GET | `/preview/{id}/*` | Preview 代理 (HTTP + WebSocket) |
| POST | `/sessions/{id}/view/start` | 构建并启动 Production View |
| POST | `/sessions/{id}/view/stop` | 停止 Production View |
| GET | `/sessions/{id}/view/status` | Production View 状态 |
| GET | `/view/{id}/*` | Production View 代理 |
| GET | `/sessions/{id}/uns` | 获取 UNS.json |
| POST | `/flow/start` | 启动共享 Node-RED |
| GET | `/flow/status` | Flow 状态 |
| GET | `/flow/*` | Flow 代理 |

## 项目结构

```
├── src/agent_backend/    # 后端 (FastAPI)
│   ├── main.py           # 入口 + 路由
│   ├── session.py        # Session 管理 + SQLite
│   ├── agent.py          # Claude Agent 执行器
│   ├── preview.py        # Preview 服务器管理 (Dev + HMR)
│   ├── view.py           # View 服务器管理 (Production)
│   ├── flow.py           # Node-RED Flow 管理
│   └── permissions.py    # 权限管理
├── frontend/             # 前端 (React + Vite + Shadcn)
│   ├── src/
│   │   ├── components/   # UI 组件
│   │   ├── hooks/        # 自定义 Hooks
│   │   └── lib/          # 工具函数
│   └── dist/             # 构建产物
├── node_modules/         # Node-RED 本地安装
├── .nodered/             # Node-RED 数据目录 (flows, settings)
├── .sessions/            # Session 工作目录 (自动创建)
├── package.json          # Node-RED 依赖
└── claude.md             # Agent 构建指南
```

## 注意事项

- **非 root 用户**: Claude Agent SDK 的 `bypassPermissions` 模式要求非 root 用户运行
- **首次使用**: 需要先完成 `claude` CLI 登录认证

## License

MIT
