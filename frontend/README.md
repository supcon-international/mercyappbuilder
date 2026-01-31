# Frontend (React + Vite)

前端提供会话管理、聊天交互、Preview/View/Flow 嵌入与 `/status` 资源监控页面。

## 开发启动
```bash
npm install
npm run dev
```
默认访问 http://localhost:5173

## 构建
```bash
npm run build
```

## E2E 测试（Playwright）
```bash
npm run test:e2e
```
可选环境变量：
- `E2E_BASE_URL`：覆盖测试访问地址
- `E2E_SKIP_BACKEND=1`：跳过依赖后端的动作

更多整体说明请查看仓库根目录 `README.md`。
