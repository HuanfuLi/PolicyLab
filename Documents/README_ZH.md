# Ideal World（理想世界）

Ideal World 是一个本地优先的 TypeScript 工作区，用于设计、模拟、反思和比较由 LLM 驱动的微型社会。它将基于 LLM 的意图生成与确定性机制结合，用于处理属性、市场、生理状态和遥测数据。

## 项目功能

应用支持完整的会话生命周期：

1. 创意输入
2. 头脑风暴
3. 设计生成与细化
4. 运行模拟
5. 反思
6. 评审 / 对比

在模拟阶段，公民代理通过 LLM 提出意图，中央代理生成社会层面的决议，而确定性机制负责真正应用经济和生理层面的结果。

## 工作区结构

- `web/`：Vite + React 前端
- `server/`：Express API、编排逻辑、机制系统、持久化
- `shared/`：共享领域类型与经济模型基础类型
- `Documents/`：架构说明、变更记录、差距分析、历史文档
- `SimulationResult/`：导出的示例结果文件

## 当前核心系统

- 支持 Anthropic、OpenAI、Gemini、Vertex 和本地兼容端点的多提供商 LLM 网关
- 基于会话阶段的工作流与持久化阶段切换
- 通过 SSE 向前端实时推送的确定性模拟循环
- 物理与动作结算引擎
- 基于 MET 的代谢系统与异体负荷持久化
- 含订单簿、AMM 状态快照和代理经济状态的闭环经济系统
- 反思、评审、对比、制品浏览以及导入 / 导出流程
- 基于 SQLite 的本地持久化，搭配 Drizzle schema 与部分高频路径上的 `better-sqlite3`

## 技术栈

- 前端：React 19、Vite、Zustand、React Router、lucide-react
- 后端：Express、TypeScript、Drizzle ORM、`better-sqlite3`
- 共享层：用于定义会话、代理、迭代和经济类型的 TypeScript 包
- 实时通信：Server-Sent Events

## 开发命令

安装依赖：

```bash
npm install
```

启动完整应用：

```bash
npm run dev
```

仅启动后端：

```bash
npm run dev:server
```

仅启动前端：

```bash
npm run dev:web
```

构建全部包：

```bash
npm run build
```

前端代码检查：

```bash
npm run lint -w web
```

## 测试

目前还没有统一的根测试命令。现有可直接执行的测试 / 沙箱脚本包括：

```bash
npx tsx server/src/llm/__tests__/phase2.test.ts
npx tsx server/src/cognition/__tests__/phase3.test.ts
npx tsx server/src/mechanics/__tests__/physics_sandbox.ts --json
```

## 数据与持久化

- 主数据库：`~/.idealworld/idealworld.db`
- 会话、代理、迭代、反思、消息和经济状态都保存在本地
- 模拟遥测会嵌入到迭代统计中，并通过导出与遥测接口暴露
- AMM 与生理状态会持久化，以支持暂停 / 恢复和重启后的状态恢复

## 主要用户界面

当前前端包含以下页面：

- 首页 / 会话列表
- 创意输入
- 头脑风暴
- 设计评审
- 模拟
- 反思
- 代理评审
- 会话对比
- 制品浏览
- 物理实验室
- 设置

## 说明

- 本仓库是本地优先项目，不依赖云端项目状态。
- 不要提交 API Key、本地数据库文件或供应商密钥。
- `Documents/Legacy/` 中的历史文档可能与当前实现不一致。

## 许可证

本项目采用 GNU Affero General Public License v3.0。详见 [LICENSE](LICENSE)。
