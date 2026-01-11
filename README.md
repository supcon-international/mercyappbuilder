# Tier0 Appbuilder

基于 Claude Agent SDK 的 Web 应用构建器，支持多 Session、实时预览、流式响应。

## 快速开始

```bash
# 后端
uv sync
uv run uvicorn src.agent_backend.main:app --host 0.0.0.0 --port 8000

# 前端
cd frontend && npm install && npm run dev
```

访问 http://localhost:5173

## 端口

| 服务 | 端口 | 说明 |
|------|------|------|
| 后端 API | 8000 | FastAPI，提供 REST API 和 Preview 代理 |
| 前端 | 5173 | Vite 开发服务器 |
| Preview | 4001-4100 | 动态分配，Session 内 Web 项目预览 |

## 公网访问（Tunnel）

穿透 **8000 端口** 即可。后端会：
- 代理前端请求到 5173
- 代理 `/api/*` 请求到内部 API
- 代理 `/preview/{session_id}/*` 到对应 Preview 服务器

## 核心功能

- **多 Session**: 独立工作目录，隔离的对话历史
- **流式响应**: SSE 实时输出，支持思考过程展示
- **Preview**: 实时预览 Session 内构建的 Web 项目
- **SQLite 持久化**: 会话和消息持久化，重启不丢失
- **国际化**: 中英文切换

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
│   ├── session.py        # Session 管理
│   ├── agent.py          # Claude Agent 执行器
│   └── preview.py        # Preview 服务器管理
├── frontend/             # 前端 (React + Vite)
│   └── src/
│       ├── components/   # UI 组件
│       └── hooks/        # 自定义 Hooks
├── .sessions/            # Session 工作目录 (自动创建)
└── claude.md             # Agent 构建指南
```

## License

MIT
