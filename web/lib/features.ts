/**
 * 前端功能入口开关 —— 「收入口不删码」策略（2026-10 与咏欣定的方案）。
 *
 * 背景：财问的产品定位是面向学生的校园规章/生活问答（直接提问，不挑模块）。
 * deep_solve / deep_question / deep_research / math_animator / visualize 这些
 * playground 能力没有使用场景，聊天工具里的 brainstorm / code_execution /
 * reason / paper_search 同理（code_execution 上校服务器后还是不必要的攻击面）。
 * 2026-10-06 二次裁剪：以上能力**连管理员入口也收掉**（演示也不走这些模块），
 * 工具菜单只留 web_search 可开关，rag 常开但不显示（见 ALWAYS_ON_TOOLS）。
 *
 * 但这些功能的**前后端代码全部保留**：软著申请材料（操作手册）按全功能编写，
 * 且手册描述的是「系统具备的能力」——入口收掉后代码仍在，手册无需改动，
 * 演示或后续恢复时改回这里即可。后端 Capability/Tool 注册不动，
 * 直接调 WebSocket 仍可触达，本文件只管前端入口的可见性。
 *
 * 消费方：
 *  - app/(workspace)/chat/[[...sessionId]]/page.tsx —— capability / tool 列表过滤
 *  - components/chat/home/ChatComposer.tsx —— 仅剩一个 capability 时隐藏选择按钮
 *  - components/sidebar/SidebarShell.tsx —— 侧边栏 ADMIN_ONLY_HREFS（独立维护）
 *  - middleware.ts —— 路由级兜底 ADMIN_ROUTES（独立维护）
 */

/**
 * 对**所有人**隐藏的 Capability（含管理员，2026-10-06 二次裁剪：
 * 用户确认五个 playground 模块连管理员入口也收掉，能力选择器整体消失）。
 * 代码零删除——恢复时从本 Set 移除对应项即可。
 */
export const HIDDEN_CAPABILITIES = new Set([
  "deep_solve", // 深度解题
  "deep_question", // 题目生成
  "deep_research", // 深度研究
  "math_animator", // 数学动画
  "visualize", // 可视化
]);

/**
 * 工具菜单里**可见且可开关**的工具：只留联网搜索（2026-10-06 用户定）。
 * 头脑风暴/代码/推理/论文搜索 对所有人隐藏，代码保留。
 */
export const MENU_TOOLS = ["web_search"] as const;

/**
 * 不在工具菜单显示、但**强制保持开启**的工具。
 * 只有 rag（知识库检索）：它是财问问答的核心链路，page.tsx 的工具裁剪
 * effect 会把它从菜单隐掉的同时补回 enabledTools——如果做成可开关，
 * 学生误关会导致知识库检索静默失效。
 */
export const ALWAYS_ON_TOOLS = ["rag"] as const;

/**
 * 聊天输入区「空间」@ 引用菜单（ChatSpaceMenu：聊天历史/书籍/笔记本/题库/
 * 技能/记忆）对**管理员**可见的项。普通用户整个「空间」按钮和 @ 提及菜单
 * 都隐藏（见 page.tsx 的 visibleSpaceKeys）。
 *
 * 2026-10-06 决定：六项里只留 memory（长时记忆手动附加）——
 * 书籍/题库的数据来源本身已收为管理员功能；笔记本/技能/聊天历史引用
 * 对校规问答没有使用场景，grounding 统一走知识库选择器。
 */
export const ENABLED_SPACE_KEYS = ["memory"] as const;
