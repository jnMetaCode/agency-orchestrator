// 站内更新日志：直接读取仓库根的 CHANGELOG.md（?raw 内联），解析成按版本的条目。
// 维护更新日志只需改根目录 CHANGELOG.md，本页自动同步。
import raw from "../../../CHANGELOG.md?raw";

export interface ChangelogEntry {
  /** 版本号，如 "0.6.17" */
  version: string;
  /** 日期字符串，如 "2026-04-29"（可能为空） */
  date: string;
  /** 该版本的正文（markdown，含 ### Added / Fixed 等小节） */
  body: string;
}

// 匹配 "## [0.6.17] - 2026-04-29" 这样的版本标题行。
const HEADING = /^##\s*\[([^\]]+)\]\s*(?:-\s*(.+))?$/;

export function parseChangelog(md: string = raw): ChangelogEntry[] {
  const lines = md.split("\n");
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  let bodyLines: string[] = [];

  const flush = () => {
    if (current) {
      current.body = bodyLines.join("\n").trim();
      entries.push(current);
    }
  };

  for (const line of lines) {
    const m = line.match(HEADING);
    if (m) {
      flush();
      current = { version: m[1].trim(), date: (m[2] ?? "").trim(), body: "" };
      bodyLines = [];
    } else if (current) {
      bodyLines.push(line);
    }
  }
  flush();
  return entries;
}

export const changelog: ChangelogEntry[] = parseChangelog();

/** 锚点 id：v0.6.17 */
export function changelogAnchor(version: string): string {
  return `v${version.replace(/[^\w.-]/g, "-")}`;
}
