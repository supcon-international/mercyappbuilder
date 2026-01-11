# Tier0 Appbuilder

基于 Claude Agent SDK 的 Web 应用构建器，支持多 Session、实时预览、流式响应。

## 快速开始

### 生产模式（推荐）

```bash
# 安装依赖
uv sync
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
| Preview | 4001-4100 | 动态分配，Session 内 Web 项目预览 |

## 公网访问（Tunnel）

只需穿透 **8000 端口**。后端会：
- 直接服务前端静态文件
- 处理 `/api/*` 请求
- 代理 `/preview/{session_id}/*` 到对应 Preview 服务器

## 核心功能

- **多 Session**: 独立工作目录，隔离的对话历史
- **流式响应**: SSE 实时输出，心跳保活，工具调用状态实时展示
- **Preview**: 实时预览 Session 内构建的 Web 项目
- **SQLite 持久化**: 会话和消息持久化，重启不丢失
- **国际化**: 中英文切换
- **bypassPermissions**: 自动执行工具，无需手动批准

## API

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/sessions` | 创建 Session |
| GET | `/sessions` | 列出 Sessions |
| DELETE | `/sessions/{id}?delete=true` | 删除 Session |
| POST | `/sessions/{id}/chat/stream` | 发送消息（流式）|
| GET | `/sessions/{id}/history` | 获取历史 |
| POST | `/sessions/{id}/preview/start` | 启动 Preview |
| GET | `/preview/{id}/*` | Preview 代理 |

## 项目结构

```
├── src/agent_backend/    # 后端 (FastAPI)
│   ├── main.py           # 入口 + 路由
│   ├── session.py        # Session 管理 + SQLite
│   ├── agent.py          # Claude Agent 执行器
│   └── preview.py        # Preview 服务器管理
├── frontend/             # 前端 (React + Vite + Shadcn)
│   ├── src/
│   │   ├── components/   # UI 组件
│   │   └── hooks/        # 自定义 Hooks
│   └── dist/             # 构建产物（被后端服务）
├── .sessions/            # Session 工作目录 (自动创建)
└── claude.md             # Agent 构建指南
```

## 注意事项

- **非 root 用户**: Claude Agent SDK 的 `bypassPermissions` 模式要求非 root 用户运行
- **首次使用**: 需要先完成 `claude` CLI 登录认证

## License

MIT
