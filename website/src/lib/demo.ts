// 公开站「演示模式」数据层：没有本地后端时，专家库直接读静态数据
// （experts.json + public/prompts/*.md），可浏览 / 查看 / 复制提示词，但不能真跑。
import expertsData from "@/content/experts.json";
import type { Role } from "./studio";

interface ExpertEntry {
  category: string;
  categoryName: string;
  id: string;
  name: string;
  description: string;
  emoji?: string;
  color?: string;
}

const DATA = expertsData as { zh: ExpertEntry[]; en: ExpertEntry[] };

export function demoRoles(lang: "zh" | "en"): Role[] {
  const arr = DATA[lang] ?? DATA.zh;
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
