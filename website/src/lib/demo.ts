// 公开站「演示模式」数据层：没有本地后端时，专家库直接读静态数据
// （experts.json + public/prompts/*.md），可浏览 / 查看 / 复制提示词，但不能真跑。
// experts.json(~150kB)动态加载，避免被打进 Studio 首屏 chunk（只有进演示模式才取）。
import type { Role, Workflow } from "./studio";

interface ExpertEntry {
  category: string;
  categoryName: string;
  id: string;
  name: string;
  description: string;
  emoji?: string;
  color?: string;
}

let _data: { zh: ExpertEntry[]; en: ExpertEntry[] } | null = null;
async function loadData() {
  if (!_data) _data = (await import("@/content/experts.json")).default as { zh: ExpertEntry[]; en: ExpertEntry[] };
  return _data;
}

export async function demoRoles(lang: "zh" | "en"): Promise<Role[]> {
  const data = await loadData();
  const arr = data[lang] ?? data.zh;
  return arr.map((e) => ({
    id: e.id,
    category: e.category,
    categoryName: e.categoryName,
    name: e.name,
    description: e.description,
    color: e.color,
  }));
}

export async function demoRoleContent(lang: "zh" | "en", category: string, id: string): Promise<string> {
  const res = await fetch(`/prompts/${lang}/${category}/${id}.md`);
  if (!res.ok) throw new Error("not found");
  return res.text();
}

// 演示模式工作流：公开站无后端，读取内置模板的静态快照(由 scripts/gen-workflows.mjs 生成)，
// 可浏览 / 看步骤，但不能真跑。
// 媒体步骤（image / video / concat / tts）没有 role，所以 role 是可选的；type 决定它是不是"创意出片"模板
interface WfSnapshot { name: string; description: string; category?: string; featured?: boolean; steps: { id?: string; role?: string; type?: string; name?: string; emoji?: string }[] }

/** 演示模式工作流列表(完整内置模板快照，file 用 demo:// 占位，不可真跑)。 */
export async function demoWorkflows(lang: "zh" | "en"): Promise<Workflow[]> {
  const data = (await import("@/content/workflows.json")).default as { zh: WfSnapshot[]; en: WfSnapshot[] };
  const arr = (lang === "en" ? data.en : data.zh) ?? data.zh ?? [];
  return arr.map((w, i) => ({
    file: `demo://${i}`,
    filename: `${i}.yaml`,
    name: w.name,
    description: w.description,
    category: w.category,
    featured: w.featured,
    inputs: [],
    // type 必须带上：「创意出片」按 step.type 筛模板，丢了它演示模式下那一页就是空的
    steps: w.steps.map((s, j) => ({ id: s.id || `step_${j + 1}`, role: s.role, type: s.type, name: s.name, emoji: s.emoji })),
    private: false,
  }));
}
