/**
 * 黄金评测任务集 —— 评测闭环的稳定输入。
 *
 * 每条 = 一个旗舰内置工作流 + 一组代表性输入，覆盖创作 / 社媒 / 商业 / 分析 / 产品五类，
 * 用来回答核心假设「多专家 DAG 协作是否真的优于一句话 one-shot」，并能看出在哪类任务上稳赢。
 * 改动这里 = 改动评测口径，请保持任务有代表性、输入零歧义。
 */
export interface GoldenTask {
  /** workflows/ 下的文件名 */
  file: string;
  /** 任务类别（用于分析多专家在哪类任务上稳赢） */
  category: "创作" | "社媒" | "商业" | "分析" | "产品";
  /** required 无默认的字段在这里补；留空表示用工作流自带 default */
  inputs: Record<string, string>;
}

export const GOLDEN_TASKS: GoldenTask[] = [
  { file: "story-creation.yaml", category: "创作", inputs: {} },
  { file: "tech-blog.yaml", category: "创作", inputs: { topic: "用 Rust 重写 Python 数据处理热点函数：从 12 秒到 0.8 秒的实战与踩坑" } },
  { file: "ai-opinion-article.yaml", category: "创作", inputs: { topic: "为什么大多数人用不好 AI：不是模型不行，是不会提问" } },
  { file: "xiaohongshu-viral-post.yaml", category: "社媒", inputs: { topic: "职场新人前 3 个月避坑指南" } },
  { file: "douyin-script.yaml", category: "社媒", inputs: { topic: "30 岁转行做程序员还来得及吗" } },
  { file: "pitch-deck-outline.yaml", category: "商业", inputs: { startup_idea: "用 AI 帮跨境电商中小卖家自动生成多语言商品详情页，降低本地化成本" } },
  { file: "okr-decomposition.yaml", category: "商业", inputs: { annual_goal: "让 SaaS 产品年度经常性收入 ARR 从 200 万做到 1000 万" } },
  { file: "investment-analysis.yaml", category: "分析", inputs: { target: "纳斯达克100指数ETF" } },
  {
    file: "product-review.yaml",
    category: "产品",
    inputs: {
      prd_content: [
        "# PRD：工作流执行结果一键分享",
        "## 背景：用户跑完多智能体工作流后想把成果分享给同事/客户，目前只能复制粘贴文本，排版丢失、不美观。",
        "## 目标：让用户一键把某次运行结果生成一个可分享的网页链接（含各步骤产出、可折叠）。",
        "## 范围：1) 运行结束后 CLI 给出「生成分享链接」提示；2) 上传到对象存储生成短链；3) 网页端只读展示，支持按步骤折叠、复制单步。",
        "## 非目标：不做评论/协作编辑；不做权限系统（链接即访问）。",
        "## 指标：分享转化率（跑完→生成链接）>20%；被分享链接的人均打开数。",
      ].join("\n"),
    },
  },
];

/** 兼容旧用法：filename → inputs 映射 */
export const GOLDEN_FIXTURES: Record<string, Record<string, string>> = Object.fromEntries(
  GOLDEN_TASKS.map((t) => [t.file, t.inputs]),
);
