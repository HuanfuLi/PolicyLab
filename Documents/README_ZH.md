# PolicyLab（政策实验室）

> **更新于:** 2026-04-05（v1.0 里程碑完成）

PolicyLab 是一个本地优先、LLM 驱动的多代理经济模拟平台，用于政策实验。政策制定者可以设计 20-150+ 代理的微型社会，配置经济参数，运行模拟（LLM 认知与确定性经济引擎相结合），并对比政策结果。

从 Ideal World 项目 fork 而来，更聚焦于经济现实性和政策评估。

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
- 基于会话阶段的完整工作流（创意 → 头脑风暴 → 设计 → 模拟 → 反思 → 评审）
- 通过 SSE 向前端实时推送的确定性模拟循环
- **部分准备金银行制度** — 银行代理、存款账户、贷款生命周期、M1 扩张
- **资本市场** — 企业股权（股份 + 分红）、政府和企业债券（票息 + 到期）
- **财政政策** — 预算类别（基建、教育、国防、福利），支出乘数效应，公共品质量
- **通货膨胀动态** — 基于拉氏篮子的 CPI、M1 反馈、中央银行政策调整
- **经济仪表盘** — 4 个实时图表面板（CPI、货币供应、财政、债券收益率）
- **真实世界引导** — 从世界银行 API 获取 23 个经济指标，自动生成模拟起点
- **情景构建器** — 标签式 A/B 政策比较，参数差异标记
- 基于 MET 的代谢系统与异体负荷持久化
- 含订单簿、AMM 状态快照和代理经济状态的闭环 SFC 经济系统
- 反思、评审、对比、制品浏览以及导入 / 导出流程
- 基于 SQLite 的本地持久化（26 张表），搭配 Drizzle schema 与部分高频路径上的 `better-sqlite3`

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

```bash
npm run test -w server   # 运行 195 个服务端测试（vitest）
npm run lint -w web      # 前端代码检查
```

## 数据与持久化

- 主数据库：`~/.policylab/policylab.db`
- 配置文件：`~/.policylab/config.json`（LLM API 密钥、提供商选择）
- 位置数据缓存：`~/.policylab/cache/`（每国 30 天有效期）
- 会话、代理、迭代、反思、消息和经济状态都保存在本地
- 模拟遥测会嵌入到迭代统计中，并通过导出与遥测接口暴露
- AMM、银行、资本市场与生理状态会持久化，以支持暂停 / 恢复和重启后的状态恢复

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
