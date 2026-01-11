# Tier0 Appbuilder

一个基于 Claude Agent SDK 的多 Session Agent 后端服务，每个 Session 可以拥有独立的工作目录。

## 功能特性

- **多 Session 支持**: 同时管理多个独立的 Agent Session
- **自动隔离工作目录**: 每个 Session 自动创建独立的工作目录（基于 session_id），Agent 只能在自己的目录下工作
- **自动清理**: 删除 Session 时自动删除对应的工作目录
- **会话历史**: 自动维护每个 Session 的对话历史（SQLite 持久化）
- **流式响应**: 支持 SSE (Server-Sent Events) 流式输出
- **自定义配置**: 每个 Session 可以配置独立的系统提示词、允许的工具列表和模型
- **React 前端**: 现代化的 Web 界面，支持流式渲染、工具调用展示、思考过程显示
- **Preview 预览**: 支持在线预览 Session 内构建的 Web 项目
- **Preview 代理**: 支持通过反向代理公网访问 Preview（适用于 Cloudflare Tunnel 等）
- **国际化**: 支持中英文双语切换

## 端口配置

| 服务 | 端口 | 说明 |
|------|------|------|
| **后端 API** | 8000 | FastAPI 服务，提供 REST API |
| **前端** | 5173 | Vite 开发服务器 |
| **Preview** | 4001-4100 | 动态分配，用于预览 Session 内的 Web 项目 |

### 公网访问（Tunnel）

当通过 Cloudflare Tunnel 等工具穿透到公网时：
- 只需穿透 **后端 API (8000)** 和 **前端 (5173)** 两个端口
- Preview 通过后端反向代理访问：`/preview/{session_id}/`
- 无需为每个 Preview 端口单独配置 Tunnel

## 安装

### 使用 uv (推荐)

```bash
# 创建虚拟环境并安装依赖
uv sync

# 或者只安装依赖
uv pip install -e .
```

### 使用 pip

```bash
pip install -e .
```

## 配置

确保设置了 Anthropic API Key:

```bash
export ANTHROPIC_API_KEY="your-api-key"
```

## 启动服务

### 启动后端

```bash
# 使用 uvicorn 直接启动
uv run uvicorn src.agent_backend.main:app --host 0.0.0.0 --port 8000 --reload

# 或者使用模块入口
uv run python -m src.agent_backend.main
```

启动时会打印端口信息：
```
============================================================
  Tier0 Appbuilder - Backend Server
============================================================
  API Server:      http://localhost:8000
  Frontend:        http://localhost:5173
  Preview Ports:   4001-4100
  Preview Proxy:   /preview/{session_id}/
============================================================
```

服务启动后，访问 http://localhost:8000/docs 查看 API 文档。

### 启动前端

```bash
cd frontend
npm install
npm run dev
```

前端启动后，访问 http://localhost:5173 使用 Web 界面。

## API 使用示例

### 创建 Session

```bash
curl -X POST http://localhost:8000/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "system_prompt": "基于 claude.md 完成应用构建",
    "model": "claude-opus-4-5-20251101"
  }'
```

响应:
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "working_directory": "/path/to/project/.sessions/550e8400-e29b-41d4-a716-446655440000",
  "status": "active",
  "created_at": "2025-01-09T10:00:00",
  "last_activity": "2025-01-09T10:00:00",
  "message_count": 0,
  "model": "claude-opus-4-5-20251101"
}
```

> 注意：工作目录会根据 session_id 自动创建在项目目录下的 `.sessions/` 文件夹中，每个 Session 只能在自己的目录下工作。

### 发送消息

```bash
curl -X POST http://localhost:8000/sessions/{session_id}/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "请分析当前目录下的代码结构"
  }'
```

### 流式响应

```bash
curl -X POST http://localhost:8000/sessions/{session_id}/chat/stream \
  -H "Content-Type: application/json" \
  -d '{
    "message": "请帮我创建一个简单的 Python 脚本"
  }'
```

### 查看会话历史

```bash
curl http://localhost:8000/sessions/{session_id}/history
```

### 列出所有 Session

```bash
curl http://localhost:8000/sessions
```

### 关闭 Session

```bash
# 仅关闭（保留在内存中）
curl -X DELETE http://localhost:8000/sessions/{session_id}

# 删除 Session 和工作目录
curl -X DELETE "http://localhost:8000/sessions/{session_id}?delete=true"

# 删除 Session 但保留工作目录
curl -X DELETE "http://localhost:8000/sessions/{session_id}?delete=true&keep_directory=true"
```

## API 端点

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/sessions` | 创建新 Session |
| GET | `/sessions` | 列出所有 Session |
| GET | `/sessions/{id}` | 获取 Session 信息 |
| DELETE | `/sessions/{id}` | 关闭/删除 Session |
| POST | `/sessions/{id}/chat` | 发送消息 |
| POST | `/sessions/{id}/chat/stream` | 发送消息（流式） |
| GET | `/sessions/{id}/history` | 获取会话历史 |
| DELETE | `/sessions/{id}/history` | 清空会话历史 |
| POST | `/sessions/{id}/preview/start` | 启动 Preview 服务器 |
| POST | `/sessions/{id}/preview/stop` | 停止 Preview 服务器 |
| GET | `/sessions/{id}/preview/status` | 获取 Preview 状态 |
| GET | `/preview/{id}/*` | Preview 反向代理（用于公网访问） |
| GET | `/health` | 健康检查 |

## Session 配置选项

| 参数 | 类型 | 说明 |
|------|------|------|
| `system_prompt` | string | 系统提示词，默认 `基于 claude.md 完成应用构建` |
| `allowed_tools` | list[string] | 可选，允许使用的工具列表 |
| `model` | string | Claude 模型，默认 `claude-opus-4-5-20251101` |

> 工作目录会自动创建在项目目录下的 `.sessions/{session_id}/`，无需手动指定。

## 可用的工具

Agent 可以使用以下工具（取决于配置）:

- `Read` - 读取文件
- `Write` - 写入文件
- `Edit` - 编辑文件
- `Bash` - 执行 Shell 命令
- `Glob` - 文件模式匹配
- `Grep` - 搜索文件内容
- `LS` - 列出目录内容

## 项目结构

```
claude-agent-backend/
├── pyproject.toml          # 项目配置和依赖
├── README.md               # 本文档
├── .sessions/              # Session 工作目录（自动创建）
├── src/
│   └── agent_backend/
│       ├── __init__.py     # 包初始化
│       ├── main.py         # FastAPI 应用入口
│       ├── session.py      # Session 管理
│       ├── agent.py        # Agent 执行器
│       └── models.py       # Pydantic 数据模型
└── frontend/               # React 前端
    ├── src/
    │   ├── components/     # React 组件
    │   ├── hooks/          # 自定义 Hooks
    │   ├── lib/            # 工具函数和 API
    │   └── types/          # TypeScript 类型
    └── ...
```

## 开发

```bash
# 安装开发依赖
uv sync --dev

# 运行测试
uv run pytest

# 格式化代码
uv run ruff format .

# 代码检查
uv run ruff check .
```

## License

MIT
