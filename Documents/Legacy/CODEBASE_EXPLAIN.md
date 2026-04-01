# Ideal World 项目代码库结构与技术架构解析

本文档提供 Ideal World 项目的代码级架构指南，旨在说明系统的模块划分、核心算法（神经符号架构、MapReduce状态推演）以及底层数值计算与资源约束机制的设计实现。

本文结合关键模块的源代码片段进行技术原理阐释。

## 1. 系统架构概览

Ideal World 是基于本地化技术栈构建的多智能体微观社会模拟平台。系统设计目标是在受限计算资源下，模拟多智能体在预设物理规则下的交互与状态演变。

*   **架构体系**: Monorepo（基于 npm workspaces）
*   **前端平台**: React 19、TypeScript、Zustand、TailwindCSS、Vite。前端依赖 Server-Sent Events 处理服务端状态推送，采用 requestAnimationFrame 实现批量渲染优化。
*   **后端平台**: Node.js、Express、TypeScript。后端负责任务调度、大语言模型路由控制、数据库 CRUD 操作及核心确定性逻辑运算。
*   **共享库**: 提供跨端共享的 TypeScript 类型定义、接口协议及常量配置。

### 核心智能体类型
1.  **Central Agent（中央智能体）**：系统全局控制器。负责环境初始化阶段生成社会背景、规则描述及市民属性数据集。在模拟循环阶段负责解析全体市民的自然语言输出，对冲突事件进行算法仲裁，并输出当前迭代的宏观状态总结。
2.  **Citizen Agents（市民智能体）**：数量在20至150名之间的个体模型。每个实例具有独立的背景设定、职业属性以及三项基础数值（财富、健康、幸福）和两项隐藏状态变量（皮质醇、多巴胺）。该类型智能体在系统中处于只读状态，其计算属性由系统底层的确定性引擎与中央智能体统一修改。

## 2. 核心模拟工作流

系统运行周期划分为四个主要阶段。

### 2.1 阶段一：环境初始化与数据集生成
该阶段逻辑由 server/src/orchestration/designOrchestrator.ts 和 server/src/llm/centralAgent.ts 控制。

系统接收初始配置参数（治理、经济、法律、文化、基建），触发调用，通过预设格式约束 Schema 生成初始社会数据集。

**核心代码片段（server/src/llm/centralAgent.ts）：**
```typescript
  // 步骤三: 生成市民实体
  onProgress({ type: 'step_start', step: 'agents', stepIndex: 2, totalSteps: 3 });

  // 调用 buildAgentRosterMessages 约束模型生成对应数量的结构化数据
  const agentsRaw = await withRetry(() =>
    provider.chat(
      buildAgentRosterMessages(
        overviewData.overview,
        lawData.law,
        agentCount, 
        overviewData.governanceModel,
        overviewData.economicModel
      ),
      { maxTokens: 8192 }   // 提升输出上限阈值配置，防止长文本截断
    )
  );

  // 映射至预设 JSON 结构
  const agentsData = parseJSON<{
    agents: Array<{
      name: string;
      role: string;
      background: string;
      initialStats: { wealth: number; health: number; happiness: number };
    }>;
  }>(agentsRaw);
```
**技术解析**：环境初始化阶段通过提高 maxTokens 参数至8192以防止大数组响应被截断。随后利用定制的 parseJSON 容错函数，对非结构化文本进行匹配与数据提取，最终映射为类型安全的市民实体列表并持久化。

### 2.2 阶段二：神经符号架构与主控循环
为解决单一模型输出因安全限制策略偏好导致的无效计算问题，系统引入了神经符号架构体系：
*   **神经网络层**：处理非结构化文本生成及自然语言逻辑推理。
*   **符号计算层**：独立于模型之外，执行完全确定性的资源分配与属性核算逻辑。

在模拟环境的迭代周期内部，控制流逻辑如下：

#### 2.2.1 标准化行动指令集定义
**核心代码片段（server/src/mechanics/actionCodes.ts）：**
```typescript
export type ActionCode =
  | 'WORK'
  | 'TRADE'
  | 'REST'
  | 'STRIKE'
  | 'STEAL'
  | 'HELP'
  | 'INVEST'
  | 'CONSUME'
  | 'NONE';
```
**技术解析**：系统在系统提示语中注入指令，要求智能体在生成非结构化意图的同时，必须以结构化格式携带上述 ActionCode 字面量集中的单一项。此设定为后续符号计算层提供了明确的执行目标。

#### 2.2.2 并发状态采集
**核心代码片段（server/src/orchestration/simulationRunner.ts）：**
```typescript
const intentTasks = aliveAgents.map(agent => async (): Promise<AgentIntent> => {
    const messages = buildIntentPrompt(agent, session, previousSummary, iterNum);
    const parsed = await retryWithHealing({
        provider: citizenProv, // 路由至适用的推理模型端点
        messages,
        options: { model: settings.citizenAgentModel },
        parse: (raw) => { ... }
    });
    return parsed;
});
const intents = await runWithConcurrency(intentTasks, settings.maxConcurrency);
```
**技术解析**：系统采用 Promise.all 映射机制对全体节点并发下发运算请求。各实体的当前状态变量阵列及全局日志文本将被注入每次独立调用的上下文环境。并发池函数限制了同一时刻发往外部接口的最大线程数。

#### 2.2.3 基于 MapReduce 的层级化状态解析
针对大规模并发集群产生的长尾延迟与上下文溢出问题，系统设计了基于局部聚合的 MapReduce 方案。
**核心代码片段（server/src/orchestration/simulationRunner.ts）：**
```typescript
if (aliveAgents.length > MAPREDUCE_THRESHOLD) { 
    // Mapper 阶段: 根据设定阈值及内部属性划分子任务组
    const groups = clusterByRole(aliveAgents, BATCH_SIZE);
    const groupTasks = groups.map((group, gi) => async () => {
        const msgs = buildGroupResolutionMessages(...);
        return retryWithHealing({ provider: citizenProv, ... });
    });
    const groupResults = await runWithConcurrency(groupTasks, ...);

    // Reducer 阶段: 聚合各局部节点输出执行全局状态合并
    const groupSummaries = groupResults.map(r => r.groupSummary);
    const mergeMessages = buildMergeResolutionMessages(session, groupSummaries, ...);
    const mergeResult = await retryWithHealing({ provider: provider, ... });
}
```
**技术解析**：将高指数级复杂度的节点交互关系图切分为相互独立的离散子图。基础模型负责处理局部图内部的连通性事件，而具有更高参数量的中央控制模型负责合并子图输出，执行宏观统计特征分析，以此方法调优总体 API 使用率与响应延迟。

#### 2.2.4 确定性状态核算系统
系统底层建立了一套基于算术运算的检验规则，用于替代模型的幻觉干预。
**核心代码片段（server/src/mechanics/physicsEngine.ts）：**
```typescript
export function resolveAction(input: PhysicsInput): PhysicsOutput {
  const { agent, actionCode, actionTarget, allAgents } = input;
  let w = 0, h = 0, hap = 0, cor = 0, dop = 0;

  switch (actionCode) {
    case 'WORK':
      w = roleIncome(agent.role); 
      h = -2;   
      hap = -1; 
      cor = -3; 
      break;
    case 'STEAL':
      w = stealCalc(agent, allAgents, actionTarget); 
      h = -5;   
      hap = -3;
      cor = 10; 
      break;
    ...
  }
  return { wealthDelta: w, healthDelta: h, ...};
}
```
**技术解析**：基于解析所得的具体类型集，规则引擎输出多维度的数值标量增减结果。程序将健康值变量降至零点及其以下定义为单次生命周期的结束条件，并借此回收或初始化该内存实例。

#### 2.2.5 检索增强机制及上下文干预
系统监控内部状态标量，并在超越临界阈值时启动外部环境注入协议。
**核心代码片段（server/src/mechanics/historicalRAG.ts）：**
```typescript
const HISTORICAL_SNIPPETS: HistoricalSnippet[] = [
  {
    category: 'famine',
    era: 'Irish Famine, 1845–1852',
    mindset: 'You remember stories of families who ate grass and bark to survive. You must secure food and resources by any means necessary.',
    triggers: { lowWealth: true, highCortisol: true },
  },
  // 历史参数配置项
];

export function getSubconsciousDrive(cortisol, wealth, health) {
  if (cortisol <= 60) return null; // 阈值检测
  // 返回与输入状态变量匹配的增强指令字符串
}
```
**技术解析**：程序持续监听指标组。当侦测到资源短缺状态变量及内部压力标志参数超出设定边界值时，检索子系统会从静态数据库中匹配同源场景的历史参考文本。注入该强化语境后的模型输出将大概率偏离基准参数设定的防御性倾向，转向触发具有破坏性的特定分类意图。

## 3. 系统性能优化设计

在并发执行环境中，本系统应用了三类优化实现策略。

### 3.1 异步日志吞吐器
**所属模块**：server/src/db/asyncLogFlusher.ts
**机制解析**：常规同步执行数据库写入指令会导致 I/O 事件阻塞。应用通过预分配的内存环形队列结构存储排队的写入对象，并结合定时循环控制器每隔500毫秒提取队列执行 SQLite 批量写请求，基于 WAL 模式实现了高吞吐量写日志分离。

### 3.2 提示词缓存与内存利用
**所属模块**：server/src/llm/prompts.ts
**机制解析**：
```typescript
  const systemContent: ContentBlock[] = [
    { type: 'text', text: staticPrefix, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dynamicSuffix },
  ];
```
针对外部服务商提供的前置缓存接口支持，系统识别高体积静态化规则文本并附加对应的存活期标识。高并发集群调用时优先匹配云端驻留缓存结果集，大幅减少冗余输入计算损耗，降低并缩短 TTFT 首字到达响应耗时。

### 3.3 前端事件聚合渲染缓冲区
**所属模块**：web/src/stores/simulationStore.ts
**机制解析**：在包含高密度事件数据包的 SSE 传输流下，为规避 React 虚拟 DOM 前端框架的重绘级联卡顿，系统在原生全局域初始化了一组只写缓冲池。挂载浏览器的 requestAnimationFrame 接口，控制层在接收到硬件显示器下一次帧级刷新信号前，提取缓冲池事件组执行合并操作更新状态树对象，避免无效资源消耗。

## 4. 评估与回调机制

循环任务列队结案后，控制进程移交 server/src/orchestration/reflectionRunner.ts 执行日志结算分析。

回溯工作流被拆分为二次分层评估环节：
1. **第一阶段局部回调**：系统查询单一对象所绑定的时间线记录片段并装配输入流。在局部特征限制下，模型针对被摄对象行为输出独立分析数据报表。
2. **全局特征分析**：提取如基尼系数、存活率占比等汇总统计类结构化数据，协同上层采集的数据片段集整合至新一轮上下文。此环节由控制中心完成输出全量系统特征测评报告。
3. **第二阶段变量测试**：注入全局评测文件反向回馈至原始节点，探测在信息完全公开条件下节点对于初始状态理解特征的数据偏差映射值。

上述测评输出皆实行本地持久化转储，为数据仪表盘操作接口提供稳定数据源。

## 5. 持续演进路线与下一步优化计划

系统架构预置了模块化拓展接口，依据后续工程实施路径规划，底层算法规则拟按以下阶段执行重构升级。详细的渐进式组件拆分及代码实施细则可参考附带的 `PHYSICS_ENHANCEMENT_IMPLEMENTATION.md` 技术方案。

### 阶段一：物理引擎与经济基座重构
此阶段目标为解耦静态属性，构建基于实体物质与交易驱动的底层环境。
*   **1A 动态技能矩阵**：移除常量化职业收益，建立基于行动反馈的熟练度运算组件及其称号调度逻辑。
*   **1B 双轨生产与物理库存**：接入包含耐久与损耗参数的离散化库存表，支持建立实体企业并拓展雇佣劳动状态逻辑。
*   **1C 全局订单簿撮合引擎**：重构互动交易逻辑，引入基于价格与时间优先队列的集中竞价撮合中心提取全局物价行情。

### 阶段二：社会心理干预与环境闭环
此阶段目标为根据前序阶段产生的宏观指标，按周期阈值精准干预模型提示词结构。
*   **2A 宏观经济遥测**：开发针对基尼系数、通胀率及垄断比率的全局大盘聚合运算方法。
*   **2B 周期律干预控制器**：基于上述特征值的触发器体系，在繁荣、分化、危机、爆发四项边界条件下，精准切合神经层对应历史语境下发的 RAG 追加提示补丁。

### 阶段三：工作流流水线与适配改造
*   **3A 数据栈透传**：强化 `prompts.ts` 生成逻辑，确保局部库存与宏观物价等强变量数组能够前置呈现给决策模型。
*   **3B 分布式调度聚合算法重组**：废弃现行的静态角色聚类函数，开发面向经济实体、企业边界及资产净值分层的新一代 MapReduce 组团划分逻辑，以维持处理冲突时的情境连续性。