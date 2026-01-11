# CLAUDE.md — 快速应用生成器

**目标**: 生成简洁可用的 Web 应用，5分钟内完成。

**核心原则**:
- **极简优先** - 用最少代码实现核心功能
- **使用脚手架** - 不手写样板代码
- **快速交付** - 不追求完美，先让它跑起来

---

## 技术栈 (固定)

- **Vite + React + TypeScript** (不用 Next.js，更轻量)
- **Tailwind CSS** (内联样式，避免样式丢失)
- **shadcn/ui** (UI 组件)
- **lucide-react** (图标)
- **数据**: 使用 localStorage 或内存模拟，不需要后端

---

## 快速开始 (必须按顺序执行)

### 步骤 1: 创建项目 (30秒)

```bash
npm create vite@latest web -- --template react-ts
cd web
npm install
```

### 步骤 2: 安装依赖 (30秒)

```bash
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
npm install tailwind-merge clsx lucide-react
```

### 步骤 3: 配置 Tailwind

**tailwind.config.js**:
```js
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: { extend: {} },
  plugins: [],
}
```

**src/index.css** (替换全部内容):
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### 步骤 4: 开始写代码

直接在 `src/App.tsx` 中实现功能，**不要创建过多文件**。

---

## 代码规范 (重要!)

### ✅ 正确做法

1. **样式全用 Tailwind 类名**:
```tsx
<div className="flex items-center gap-4 p-4 bg-white rounded-lg shadow">
```

2. **组件写在同一个文件**:
```tsx
// src/App.tsx - 把所有组件都放这里
function Sidebar() { ... }
function MainContent() { ... }
export default function App() { ... }
```

3. **用 localStorage 做持久化**:
```tsx
const [data, setData] = useState(() => {
  const saved = localStorage.getItem('mydata');
  return saved ? JSON.parse(saved) : [];
});
useEffect(() => {
  localStorage.setItem('mydata', JSON.stringify(data));
}, [data]);
```

4. **用硬编码的 mock 数据先跑通**:
```tsx
const mockData = [
  { id: 1, name: "Item 1", value: 100 },
  { id: 2, name: "Item 2", value: 200 },
];
```

### ❌ 避免做法

- ❌ 不要创建 API 路由或后端
- ❌ 不要用 CSS 文件 (容易丢失样式)
- ❌ 不要创建超过 3 个文件
- ❌ 不要用复杂的状态管理 (Redux, Zustand)
- ❌ 不要做响应式设计优化
- ❌ 不要写单元测试
- ❌ 不要配置 ESLint/Prettier

---

## 完成标准 (Definition of Done)

只需满足:

1. ✅ `npm run dev` 能启动
2. ✅ 页面能打开，没有白屏
3. ✅ 核心功能可以点击/交互
4. ✅ 样式看起来像样 (用 Tailwind)

**不需要**:
- 不需要完美的 UI
- 不需要后端 API
- 不需要数据库
- 不需要部署配置

---

## 示例: MES 应用 (2分钟完成)

```tsx
// src/App.tsx
import { useState } from 'react';
import { Factory, Package, AlertTriangle, CheckCircle } from 'lucide-react';

const mockOrders = [
  { id: 'WO-001', product: '产品A', status: 'running', progress: 75 },
  { id: 'WO-002', product: '产品B', status: 'pending', progress: 0 },
  { id: 'WO-003', product: '产品C', status: 'done', progress: 100 },
];

export default function App() {
  const [orders] = useState(mockOrders);
  
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-blue-600 text-white p-4">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Factory /> MES 制造执行系统
        </h1>
      </header>
      
      <main className="p-6">
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-gray-500">进行中</div>
            <div className="text-2xl font-bold">3</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-gray-500">已完成</div>
            <div className="text-2xl font-bold text-green-600">12</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-gray-500">异常</div>
            <div className="text-2xl font-bold text-red-600">1</div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow">
          <div className="p-4 border-b font-bold">工单列表</div>
          {orders.map(order => (
            <div key={order.id} className="p-4 border-b flex items-center justify-between">
              <div>
                <div className="font-medium">{order.id}</div>
                <div className="text-sm text-gray-500">{order.product}</div>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-32 bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full" 
                    style={{ width: `${order.progress}%` }}
                  />
                </div>
                <span className="text-sm">{order.progress}%</span>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
```

---

## 时间控制

- **最多 5 分钟** 完成整个任务
- 如果遇到问题，**简化需求**而不是调试
- 有疑问就用最简单的方案
