import { Bookmark, Check, Loader2, MessageCircle, MessageSquare, Pencil, Plus, Search, Sparkles, Star, Trash2, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useLanguage } from "@/i18n/LanguageProvider";
import { api, getFavRoles, recentUsage, setFavRoles, type ComposeResult, type Role, type RunSummary, type Team, type Workflow } from "@/lib/studio";
import { track } from "@/lib/track";
import { demoRoles } from "@/lib/demo";
import { cn } from "@/lib/utils";
import { ComposePreview } from "./ComposePreview";
import { RoleAvatar } from "./RoleAvatar";
import { RoleDetail } from "./RoleDetail";
import type { ChatRole } from "./ChatPanel";
import type { RunRequest } from "./RunManager";

// 热门分类优先级（用户反馈：公司经营和常用的放前面）；不在表里的排后、保持原序
const CATEGORY_PRIORITY = ["company", "marketing", "engineering", "design", "product", "sales", "finance", "hr", "project-management", "strategy", "support", "testing", "security", "specialized"];
const catRank = (c: string) => { const i = CATEGORY_PRIORITY.indexOf(c); return i < 0 ? 99 : i; };

function roleKey(r: Role) {
  return `${r.category}/${r.id}`;
}

export function RolesPicker({
  provider,
  onRun,
  onGoToWorkflows,
  onPlainChat,
  taskSeed,
  demo,
  onInstallPrompt,
}: {
  provider: string;
  onRun: (r: RunRequest) => void;
  onGoToWorkflows?: () => void;
  /** 对话（不组队）：可选携带输入框里已敲的文本作为第一条消息；role 非空 = 带该角色人设聊 */
  onPlainChat?: (seed?: string, role?: ChatRole) => void;
  /** 外部注入的任务文本（聊天面板「组队深挖」升级桥）；n 递增防重复消费 */
  taskSeed?: { text: string; n: number } | null;
  demo?: boolean;
  onInstallPrompt?: () => void;
}) {
  const { t, lang } = useLanguage();
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [selected, setSelected] = useState<Record<string, Role>>({});

  // 角色库语言：默认跟随站点语言(zh/en)，装了官方语言包(agency-agents-ko 等)后可切换。
  // 选择存 localStorage；下拉只在有额外语言包时出现。
  const defaultLib = lang === "en" ? "en" : "zh";
  const [roleLibs, setRoleLibs] = useState<{ id: string; label: string }[]>([]);
  const [roleLib, setRoleLibState] = useState<string>(() =>
    (typeof window !== "undefined" && window.localStorage.getItem("ao-role-lib")) || "",
  );
  const effLib = roleLib || defaultLib;
  const setRoleLib = (v: string) => {
    setRoleLibState(v);
    if (typeof window !== "undefined") window.localStorage.setItem("ao-role-lib", v);
  };
  useEffect(() => {
    if (demo) return;
    api.config().then((c) => { setRoleLibs(c.roleLibs ?? []); setBudgetProviders(c.budgetProviders ?? null); }).catch(() => setRoleLibs([]));
  }, [demo]);

  // 用户自选「常用」角色：点星收藏（localStorage，与工作流的 ☆ 同一交互）
  const [favs, setFavs] = useState<Set<string>>(() => getFavRoles());
  // 最近 30 天运行里用过的角色（按次数）——"最近用过"一行芯片，点即加入组队
  const [runs, setRuns] = useState<RunSummary[]>([]);
  useEffect(() => { if (!demo) api.runs().then(setRuns).catch(() => setRuns([])); }, [demo]);
  const recentRoles = useMemo(() => {
    const byKey = new Map(roles.map((r) => [roleKey(r), r] as const));
    return recentUsage(runs, (r) => r.roles).map(([k]) => byKey.get(k)).filter((r): r is Role => !!r).slice(0, 8);
  }, [runs, roles]);
  const toggleFav = (r: Role, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavs((prev) => {
      const n = new Set(prev);
      const key = roleKey(r);
      if (n.has(key)) n.delete(key); else n.add(key);
      setFavRoles(n);
      return n;
    });
  };

  // 「我的」自建角色：新建/编辑共用一个表单弹窗(editingRole 非空=编辑模式) + 删除确认
  const [showCreate, setShowCreate] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [confirmDelRole, setConfirmDelRole] = useState<Role | null>(null);
  const [deletingRole, setDeletingRole] = useState(false);
  const [delRoleErr, setDelRoleErr] = useState<string | null>(null);

  // compose tray state
  const [task, setTask] = useState("");
  const [teamName, setTeamName] = useState("");
  const [composing, setComposing] = useState(false);
  const [composeErr, setComposeErr] = useState<string | null>(null);
  // R2.2 首跑引导：无可用凭证时后端返回 code:no_credentials，这里渲染「三选一」引导卡
  const [needKeyGuide, setNeedKeyGuide] = useState<{ installedCli?: string[]; sponsors?: { name: string; bonus?: string; url: string }[] } | null>(null);
  // 省钱模式：轻活步骤自动降便宜档（传 budget 给 /api/compose，后端 R3.2）
  const [budget, setBudget] = useState(false);
  // 省钱模式的能力清单（引擎降档表的键）。null = 后端没给（老版本/演示站），按支持处理不吓人
  const [budgetProviders, setBudgetProviders] = useState<string[] | null>(null);
  const budgetSupported = !budgetProviders || budgetProviders.includes(provider);
  const [detail, setDetail] = useState<Role | null>(null);
  const [preview, setPreview] = useState<{ result: ComposeResult; meta: Workflow | null; loading: boolean } | null>(null);

  // teams / loadouts
  const [teams, setTeams] = useState<Team[]>([]);
  const [savingTeam, setSavingTeam] = useState(false);
  const [teamMsg, setTeamMsg] = useState<string | null>(null);

  // 聊天面板「组队深挖」带过来的任务文本：填进组队输入框并滚回顶部
  const consumedTaskSeed = useRef(0);
  useEffect(() => {
    if (taskSeed && taskSeed.n !== consumedTaskSeed.current) {
      consumedTaskSeed.current = taskSeed.n;
      setTask(taskSeed.text);
      setSelected({});
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [taskSeed]);

  const refreshTeams = () => {
    if (demo) return;
    api.teams().then(setTeams).catch(() => setTeams([]));
  };
  useEffect(refreshTeams, [demo]);

  useEffect(() => {
    if (demo) {
      setLoading(true);
      demoRoles(lang)
        .then((r) => setRoles(r))
        .catch(() => setRoles([]))
        .finally(() => setLoading(false));
      return;
    }
    setLoading(true);
    api
      .roles(effLib)
      .then((r) => setRoles(r))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [lang, demo, effLib]);

  // 新建/删除自建角色后静默刷新列表（不闪 loading）
  const refreshRoles = () => {
    if (demo) return;
    api.roles(effLib).then((r) => setRoles(r)).catch(() => {});
  };

  const createMyRole = async () => {
    if (demo) { onInstallPrompt?.(); return; }
    if (!newName.trim() || !newPrompt.trim()) return;
    setCreating(true);
    setCreateErr(null);
    try {
      if (editingRole) {
        await api.updateMyRole(editingRole.id, { name: newName.trim(), description: newDesc.trim(), systemPrompt: newPrompt.trim() });
      } else {
        await api.createMyRole({ name: newName.trim(), description: newDesc.trim() || undefined, systemPrompt: newPrompt.trim() });
      }
      setShowCreate(false);
      setEditingRole(null);
      setNewName(""); setNewDesc(""); setNewPrompt("");
      setCat("my");
      refreshRoles();
    } catch (e: any) {
      setCreateErr(e?.message || t.studio.roles.newRoleFailed);
    } finally {
      setCreating(false);
    }
  };

  // 编辑自建角色：拉取全文预填进同一个表单
  const openEditRole = async (r: Role, e: React.MouseEvent) => {
    e.stopPropagation();
    setCreateErr(null);
    setEditingRole(r);
    setNewName(r.name);
    setNewDesc(r.description || "");
    setNewPrompt("");
    setShowCreate(true);
    try {
      const full = await api.role(r.category, r.id);
      setNewPrompt(full.content || "");
    } catch { /* 拉不到就留空;保存时留空则不覆盖正文(服务端字段级合并) */ }
  };

  const doDeleteRole = async () => {
    if (!confirmDelRole) return;
    setDeletingRole(true);
    setDelRoleErr(null);
    try {
      await api.deleteMyRole(confirmDelRole.id);
      // 顺手摘掉选择区/收藏里的残留引用
      setSelected((prev) => { const n = { ...prev }; delete n[roleKey(confirmDelRole)]; return n; });
      setFavs((prev) => { const n = new Set(prev); n.delete(roleKey(confirmDelRole)); setFavRoles(n); return n; });
      setConfirmDelRole(null);
      refreshRoles();
    } catch (e: any) {
      setDelRoleErr(e?.message || String(e));
    } finally {
      setDeletingRole(false);
    }
  };

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    // 「我的」有专属 tab（始终显示，含新建入口），不混进普通类目
    roles.forEach((r) => { if (r.category !== "my") map.set(r.category, r.categoryName || r.category); });
    // 「公司经营」排普通类目第一个（同 website/src/pages/Experts.tsx）：组队时先看见高管层
    // 分类顺序：热门/高频的在前（公司经营 → 营销 → 工程 → 设计 → 产品 → 销售 → 财务 → 人力），其余按目录序
    return Array.from(map, ([id, name]) => ({ id, name }))
      .sort((a, b) => catRank(a.id) - catRank(b.id));
  }, [roles]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = roles.filter((r) => {
      if (cat === "fav") { if (!favs.has(roleKey(r))) return false; }
      else if (cat !== "all" && r.category !== cat) return false;
      if (!needle) return true;
      return (r.name + r.description + r.categoryName).toLowerCase().includes(needle);
    });
    // ⭐ 常用置顶（与工作流列表同规），其余「全部」视图按分类热度排（公司经营的高管排最前），分类内保持目录序
    return [...list].sort((a, b) => ((favs.has(roleKey(b)) ? 1 : 0) - (favs.has(roleKey(a)) ? 1 : 0)) || (cat === "all" ? catRank(a.category) - catRank(b.category) : 0));
  }, [roles, q, cat, favs]);

  const selectedList = Object.values(selected);
  const count = selectedList.length;

  const toggle = (r: Role) => {
    setComposeErr(null);
    setSelected((prev) => {
      const key = roleKey(r);
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = r;
      return next;
    });
  };

  const clearSel = () => setSelected({});

  const roleByPath = useMemo(() => {
    const m: Record<string, Role> = {};
    roles.forEach((r) => { m[roleKey(r)] = r; });
    return m;
  }, [roles]);

  // 点一个已存团队：把它的角色整队载入选择区（缺失的角色——如换了语言库——跳过）
  const loadTeam = (team: Team) => {
    setComposeErr(null);
    const next: Record<string, Role> = {};
    let missing = 0;
    for (const tr of team.roles) {
      const r = roleByPath[tr.role];
      if (r) next[roleKey(r)] = r;
      else missing++;
    }
    setSelected(next);
    setTeamName(team.name);
    setTeamMsg(missing > 0 ? `${missing} ${t.studio.roles.teamLoadedMissing}` : null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // 存当前阵容为团队，返回 null = 成功，否则返回错误文案。供 tray 与 ComposePreview 复用。
  const saveTeamNamed = async (name: string): Promise<string | null> => {
    if (count < 2) return t.studio.roles.teamSaveNeedName;
    if (!name.trim()) return t.studio.roles.teamSaveNeedName;
    try {
      await api.saveTeam({
        name: name.trim(),
        roles: selectedList.map((r) => ({ role: roleKey(r), name: r.name })),
        provider: provider || undefined,
        lang,
      });
      refreshTeams();
      return null;
    } catch (e: any) {
      return e?.message || t.studio.roles.teamSaveFailed;
    }
  };

  const saveAsTeam = async () => {
    setSavingTeam(true);
    setTeamMsg(null);
    const err = await saveTeamNamed(teamName);
    setTeamMsg(err ?? `✅ ${t.studio.roles.teamSaved}`);
    setSavingTeam(false);
  };

  const deleteTeam = async (team: Team, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.deleteTeam(team.slug);
      refreshTeams();
    } catch {
      /* ignore */
    }
  };

  // 普通对话：闲聊/快问快答不值得组一支团队——输入框里已有的文本直接作为第一条消息
  const doPlainChat = () => {
    if (demo) {
      onInstallPrompt?.();
      return;
    }
    track("plain_chat_open", { seeded: !!task.trim() });
    onPlainChat?.(task.trim() || undefined);
  };

  // 单独对话 = 同一个聊天面板带上该角色人设（多轮、可追问），不再是一次性运行
  const doSingleChat = () => {
    const r = selectedList[0];
    if (!r) return;
    if (demo) {
      onInstallPrompt?.();
      return;
    }
    track("plain_chat_open", { seeded: !!task.trim(), persona: "role" });
    onPlainChat?.(task.trim() || undefined, { path: roleKey(r), name: r.name, color: r.color, lib: effLib });
  };

  // auto=true：不锁定阵容，传空 roles 让后端 LLM 自动组队（对应 CLI `ao compose "一句话"`）。
  // auto=false：手动锁定已勾选的 ≥2 个角色。
  const doComposeRun = async (auto = false) => {
    if (!task.trim()) return;
    if (!auto && count < 2) return;
    if (demo) {
      onInstallPrompt?.();
      return;
    }
    setComposing(true);
    setComposeErr(null);
    setNeedKeyGuide(null);
    const mode = auto ? "auto" : "manual";
    track("compose_start", { mode, role_count: auto ? 0 : count });
    try {
      const res = await api.compose({
        description: task.trim(),
        roles: auto ? [] : selectedList.map(roleKey),
        name: auto ? undefined : teamName.trim() || undefined,
        provider: provider || undefined,
        lang,
        budget,
        roleLang: effLib,
      });
      track("compose_success", { mode });
      // Preview the composed team before running (not a black box).
      setPreview({ result: res, meta: null, loading: true });
      try {
        const wfs = await api.workflows();
        const meta = wfs.find((w) => w.file === res.file) ?? null;
        setPreview({ result: res, meta, loading: false });
      } catch {
        setPreview({ result: res, meta: null, loading: false });
      }
    } catch (e: any) {
      track("compose_error", { mode });
      // 无凭证 → 渲染引导卡（三选一）而不是红字报错
      if (e?.body?.code === "no_credentials") setNeedKeyGuide({ installedCli: e.body.installedCli, sponsors: e.body.sponsors });
      else setComposeErr(e?.message || t.studio.roles.composeFailed);
    } finally {
      setComposing(false);
    }
  };

  if (loading)
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t.studio.roles.loading}
      </div>
    );
  if (err) return <p className="py-20 text-center text-sm text-red-500">{t.studio.roles.loadFailed}{err}</p>;

  return (
    <div className="pb-40">
      {/* AI 自动组队 —— 核心入口：不用手选角色，一句话让 LLM 从全量专家里自动挑人组队并运行。
          勾选了角色即收起：底部托盘输入和这里绑同一份 task 文本，同屏出现两个内容互相
          镜像的输入框会让人不知道该用哪个——任何时刻只留一个任务输入框（清空选择即恢复）。 */}
      {count === 0 && (
      <div className="mb-5 rounded-2xl border border-primary/30 bg-primary/5 p-4 sm:p-5">
        <div className="mb-1 flex items-center gap-2">
          <Sparkles className="size-5 text-primary" />
          <h3 className="text-base font-semibold">{t.studio.roles.autoTitle}</h3>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">{t.studio.roles.autoHint}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) doComposeRun(true);
            }}
            placeholder={t.studio.roles.autoTaskPlaceholder}
            className="h-11 flex-1 rounded-xl border border-border/70 bg-card/80 px-3.5 text-sm outline-none focus:border-primary/50"
          />
          <Button onClick={() => doComposeRun(true)} disabled={composing || !task.trim()} size="lg" className="shrink-0">
            {composing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {t.studio.roles.autoComposeBtn}
          </Button>
          <Button onClick={doPlainChat} disabled={composing} size="lg" variant="outline" title={t.studio.chat.btnTitle} className="shrink-0">
            <MessageCircle className="size-4" />
            {t.studio.chat.btn}
          </Button>
        </div>
        <label className={"mt-2.5 flex w-fit items-center gap-2 text-xs text-muted-foreground " + (budgetSupported ? "cursor-pointer" : "cursor-not-allowed opacity-60")} title={budgetSupported ? t.studio.roles.budgetModeHint : t.studio.roles.budgetNoTier}>
          <input type="checkbox" checked={budget && budgetSupported} disabled={!budgetSupported} onChange={(e) => setBudget(e.target.checked)} className="size-3.5 accent-primary" />
          <span>{t.studio.roles.budgetMode}</span>
        </label>
        {/* 当前 provider 没有已核实的便宜档 → 明说不生效,并告诉用户换到哪些能生效。
            静默空操作比不支持更糟 —— 用户以为省了钱,其实一分没省 */}
        {!budgetSupported && (
          <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{t.studio.roles.budgetNoTier}</p>
        )}
        {composing && (
          <p className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/[0.06] px-3 py-2 text-xs text-primary">
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
            {t.studio.roles.composingHint}
          </p>
        )}
        {composeErr && count === 0 && (
          <p className="mt-2 max-h-56 overflow-y-auto whitespace-pre-line rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">{composeErr}</p>
        )}
        {needKeyGuide && (
          <div className="mt-2.5 space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] px-3.5 py-3 text-xs">
            <p className="font-semibold text-amber-600 dark:text-amber-400">{t.studio.roles.needKeyTitle}</p>
            <div className="space-y-1.5 text-foreground/90">
              {needKeyGuide.installedCli && needKeyGuide.installedCli.length > 0 && (
                <p>① {t.studio.roles.needKeyCli}<code className="rounded bg-muted px-1">{needKeyGuide.installedCli[0]}</code>{t.studio.roles.needKeyCliAfter}</p>
              )}
              <p>
                ② {t.studio.roles.needKeySponsor}
                {(needKeyGuide.sponsors ?? []).map((s, i) => (
                  <span key={s.name}>
                    {i > 0 && "、"}
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => track("sponsor_click", { sponsor: s.name, surface: "need_key_banner" })}
                      className="text-primary underline"
                    >{s.name}{s.bonus ? `（${s.bonus}）` : ""}</a>
                  </span>
                ))}
                {t.studio.roles.needKeySponsorAfter}
              </p>
              <p>③ {t.studio.roles.needKeyLocal}</p>
            </div>
          </div>
        )}
        <p className="mt-2.5 text-xs text-muted-foreground/80">{t.studio.roles.autoOrManual}</p>
      </div>
      )}

      {/* onboarding hint */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border/60 bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
        <span>💡 {t.studio.roles.hintLabel}</span>
        <span><b className="text-foreground">{t.studio.roles.hintPickNoneBold}</b> {t.studio.roles.hintPickNoneRest}</span>
        <span><b className="text-foreground">{t.studio.roles.hintPickOneBold}</b> {t.studio.roles.hintPickOneRest}</span>
        <span><b className="text-foreground">{t.studio.roles.hintPickManyBold}</b> {t.studio.roles.hintPickManyRest}</span>
        <span>{t.studio.roles.hintAvatarPre}<b className="text-foreground">{t.studio.roles.hintAvatarBold}</b>{t.studio.roles.hintAvatarPost}</span>
      </div>

      {/* my teams / loadouts — 一键载入整队，套新任务 */}
      {!demo && teams.length > 0 && (
        <div className="mb-4 rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Bookmark className="size-3.5" />
            {t.studio.roles.myTeams}
            <span className="font-normal text-muted-foreground/70">· {t.studio.roles.myTeamsHint}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {teams.map((team) => (
              <button
                key={team.slug}
                onClick={() => loadTeam(team)}
                title={team.description || team.name}
                className="group flex items-center gap-2 rounded-full border border-border/70 bg-card/70 py-1 pl-3 pr-1.5 text-xs transition-colors hover:border-primary/50 hover:bg-card"
              >
                <span className="font-medium">{team.name}</span>
                <span className="text-muted-foreground/70">
                  {team.roles.slice(0, 6).map((r) => r.emoji || "•").join("")}
                  {" "}{team.roles.length}{t.studio.roles.teamMembersSuffix}
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  title={t.studio.roles.deleteTeam}
                  onClick={(e) => deleteTeam(team, e)}
                  className="grid size-5 place-items-center rounded-full text-muted-foreground/50 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
                >
                  <Trash2 className="size-3" />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* filter bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.studio.roles.searchPlaceholder}
            className="h-10 w-full rounded-xl border border-border/70 bg-card/60 pl-9 pr-3 text-sm outline-none focus:border-primary/50"
          />
        </div>
        {roleLibs.length > 2 && (
          <select
            value={effLib}
            onChange={(e) => setRoleLib(e.target.value)}
            title={t.studio.roles.libLabel}
            className="h-10 rounded-xl border border-border/70 bg-card/60 px-2.5 text-sm outline-none focus:border-primary/50"
          >
            {roleLibs.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        )}
        <span className="text-sm text-muted-foreground">{filtered.length} {t.studio.roles.rolesCountSuffix}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          onClick={() => setCat("all")}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
            cat === "all" ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:text-foreground",
          )}
        >
          {t.studio.roles.categoryAll}
        </button>
        {favs.size > 0 && (
          <button
            onClick={() => setCat("fav")}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              cat === "fav" ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:text-foreground",
            )}
          >
            <Star className={cn("size-3", cat === "fav" ? "fill-current" : "fill-amber-400 text-amber-400")} />
            {t.studio.roles.categoryFav}
          </button>
        )}
        {/* 「我的」始终显示——空着也要能发现「新建角色」入口 */}
        {!demo && (
          <button
            onClick={() => setCat("my")}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              cat === "my" ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:text-foreground",
            )}
          >
            {t.studio.roles.categoryMy}
          </button>
        )}
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setCat(c.id)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              cat === c.id ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:text-foreground",
            )}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* 最近用过：只在「全部」且未搜索时显示，与 ☆常用互补（显式 vs 隐式） */}
      {cat === "all" && !q.trim() && recentRoles.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-muted-foreground">{t.studio.roles.recentTitle}</span>
          {recentRoles.map((r) => {
            const on = !!selected[roleKey(r)];
            return (
              <button
                key={roleKey(r)}
                type="button"
                onClick={() => toggle(r)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition-colors",
                  on ? "border-primary bg-primary/10 text-primary" : "border-border/70 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                )}
              >
                {r.name}
              </button>
            );
          })}
        </div>
      )}

      {/* role grid */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* 「我的」tab 首位固定放新建入口 */}
        {cat === "my" && !demo && (
          <button
            onClick={() => { setCreateErr(null); setShowCreate(true); }}
            className="group flex min-h-32 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/80 bg-card/30 p-4 text-center transition-all hover:-translate-y-0.5 hover:border-primary/50"
          >
            <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
              <Plus className="size-5" />
            </span>
            <span className="text-sm font-semibold">{t.studio.roles.newRole}</span>
            <span className="text-xs text-muted-foreground">{t.studio.roles.newRoleHint}</span>
          </button>
        )}
        {filtered.map((r) => {
          const key = roleKey(r);
          const on = !!selected[key];
          const faved = favs.has(key);
          return (
            <button
              key={key}
              onClick={() => toggle(r)}
              className={cn(
                "group relative flex flex-col rounded-2xl border bg-card/60 p-4 text-left transition-all hover:-translate-y-0.5",
                on ? "border-primary ring-1 ring-primary/40" : "border-border/70 hover:border-primary/40",
              )}
            >
              <span
                className={cn(
                  "absolute right-3 top-3 grid size-5 place-items-center rounded-md border transition-colors",
                  on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background",
                )}
              >
                {on && <Check className="size-3.5" />}
              </span>
              <div className="flex items-center gap-3">
                <span
                  role="button"
                  tabIndex={0}
                  title={t.studio.roles.viewDetail}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDetail(r);
                  }}
                  className="rounded-full ring-offset-2 ring-offset-card transition-shadow hover:ring-2 hover:ring-primary/50"
                >
                  <RoleAvatar seed={key} name={r.name} color={r.color} className="size-12" />
                </span>
                <div className="min-w-0 pr-5">
                  <span className="block text-xs font-medium text-primary">{r.categoryName}</span>
                  <span className="flex items-center gap-1.5 font-semibold">
                    {/* ⭐ 常用：与工作流卡片同一交互，星标置顶 */}
                    <span
                      role="button"
                      tabIndex={0}
                      title={faved ? t.studio.roles.favRemove : t.studio.roles.favAdd}
                      onClick={(e) => toggleFav(r, e)}
                      className="shrink-0 text-muted-foreground/50 transition-colors hover:text-amber-400"
                    >
                      <Star className={cn("size-3.5", faved && "fill-amber-400 text-amber-400")} />
                    </span>
                    <span className="truncate">{r.name}</span>
                  </span>
                </div>
              </div>
              <span className="mt-2.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{r.description}</span>
              {/* 自建角色可删（严格限用户角色目录，内置库无此入口） */}
              {r.custom && (
                <>
                  <span
                    role="button"
                    tabIndex={0}
                    title={t.studio.roles.editRole}
                    onClick={(e) => openEditRole(r, e)}
                    className="absolute bottom-3 right-10 grid size-6 place-items-center rounded-full text-muted-foreground/50 opacity-0 transition-all hover:bg-primary/10 hover:text-primary group-hover:opacity-100"
                  >
                    <Pencil className="size-3.5" />
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    title={t.studio.roles.deleteRole}
                    onClick={(e) => { e.stopPropagation(); setDelRoleErr(null); setConfirmDelRole(r); }}
                    className="absolute bottom-3 right-3 grid size-6 place-items-center rounded-full text-muted-foreground/50 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>
      {cat === "my" && !demo && filtered.length === 0 && (
        <p className="mt-3 text-center text-xs text-muted-foreground">{t.studio.roles.myEmptyHint}</p>
      )}

      {/* selection tray */}
      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 backdrop-blur-xl">
          <div className="container-page py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-sm font-semibold text-primary">
                  {count >= 2 ? <Users className="size-4" /> : <MessageSquare className="size-4" />}
                  {t.studio.roles.selectedPrefix} {count}
                </span>
                <div className="hidden min-w-0 gap-1.5 overflow-x-auto sm:flex">
                  {selectedList.map((r) => (
                    <span
                      key={roleKey(r)}
                      className="flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-muted/50 py-1 pl-1 pr-2.5 text-xs"
                    >
                      <RoleAvatar seed={roleKey(r)} name={r.name} color={r.color} className="size-5" />
                      {r.name}
                    </span>
                  ))}
                </div>
              </div>
              <button onClick={clearSel} className="shrink-0 text-xs text-muted-foreground hover:text-foreground">
                <X className="mr-1 inline size-3.5" />
                {t.studio.roles.clear}
              </button>
            </div>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
              {count >= 2 && (
                <input
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder={t.studio.roles.teamNamePlaceholder}
                  className="h-10 rounded-xl border border-border/70 bg-card/60 px-3 text-sm outline-none focus:border-primary/50 sm:w-56"
                />
              )}
              <input
                value={task}
                onChange={(e) => setTask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (count >= 2 ? doComposeRun(false) : doSingleChat());
                }}
                placeholder={count >= 2 ? t.studio.roles.teamTaskPlaceholder : t.studio.roles.roleTaskPlaceholder}
                className="h-10 flex-1 rounded-xl border border-border/70 bg-card/60 px-3 text-sm outline-none focus:border-primary/50"
              />
              {count >= 2 ? (
                <>
                  <Button variant="outline" onClick={saveAsTeam} disabled={savingTeam} title={t.studio.roles.saveAsTeam}>
                    {savingTeam ? <Loader2 className="size-4 animate-spin" /> : <Bookmark className="size-4" />}
                    {t.studio.roles.saveAsTeam}
                  </Button>
                  <Button onClick={() => doComposeRun(false)} disabled={composing || !task.trim()}>
                    {composing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    {t.studio.roles.composeAndRun}
                  </Button>
                </>
              ) : (
                <Button onClick={doSingleChat}>
                  <MessageSquare className="size-4" />
                  {t.studio.roles.singleChat}
                </Button>
              )}
            </div>
            {composing && (
              <p className="mt-2 flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/[0.06] px-3 py-2 text-xs text-primary">
                <Loader2 className="size-3.5 shrink-0 animate-spin" />
                {t.studio.roles.composingHint}
              </p>
            )}
            {teamMsg && <p className="mt-2 text-xs text-muted-foreground">{teamMsg}</p>}
            {composeErr && (
              <p className="mt-2 max-h-56 overflow-y-auto whitespace-pre-line rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">{composeErr}</p>
            )}
          </div>
        </div>
      )}

      {/* 新建角色弹窗：名称 + 一句话描述 + system prompt，存入 ~/.ao/roles（「我的」分类） */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { if (!creating) { setShowCreate(false); setEditingRole(null); } }}>
          <div
            className="w-full max-w-lg rounded-2xl border border-border/70 bg-background p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-base font-semibold">
                {editingRole ? <Pencil className="size-4 text-primary" /> : <Plus className="size-4 text-primary" />}
                {editingRole ? t.studio.roles.editRoleTitle : t.studio.roles.newRole}
              </h3>
              <button onClick={() => { if (!creating) { setShowCreate(false); setEditingRole(null); } }} className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>
            <div className="flex flex-col gap-2.5">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t.studio.roles.newRoleNamePh}
                className="h-10 rounded-xl border border-border/70 bg-card/60 px-3 text-sm outline-none focus:border-primary/50"
              />
              <input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder={t.studio.roles.newRoleDescPh}
                className="h-10 rounded-xl border border-border/70 bg-card/60 px-3 text-sm outline-none focus:border-primary/50"
              />
              <textarea
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                placeholder={t.studio.roles.newRolePromptPh}
                className="h-40 resize-y rounded-xl border border-border/70 bg-card/60 p-3 text-sm outline-none focus:border-primary/50"
              />
            </div>
            {createErr && (
              <p className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">{createErr}</p>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setShowCreate(false); setEditingRole(null); }} disabled={creating}>
                {lang === "en" ? "Cancel" : "取消"}
              </Button>
              <Button onClick={createMyRole} disabled={creating || !newName.trim() || !newPrompt.trim()}>
                {creating ? <Loader2 className="size-4 animate-spin" /> : editingRole ? <Pencil className="size-4" /> : <Plus className="size-4" />}
                {creating
                  ? (editingRole ? t.studio.roles.editRoleSaving : t.studio.roles.newRoleCreating)
                  : (editingRole ? t.studio.roles.editRoleSave : t.studio.roles.newRoleCreate)}
              </Button>
            </div>
          </div>
        </div>
      )}
      {confirmDelRole && (
        <ConfirmDialog
          danger
          title={t.studio.roles.deleteRole}
          body={
            lang === "en"
              ? `Delete "${confirmDelRole.name}"? Its file will be removed from your roles dir (~/.ao/roles). This cannot be undone.`
              : `确定删除「${confirmDelRole.name}」？其文件将从你的角色目录（~/.ao/roles）移除，此操作不可恢复。`
          }
          confirmLabel={lang === "en" ? "Delete" : "删除"}
          cancelLabel={lang === "en" ? "Cancel" : "取消"}
          busy={deletingRole}
          error={delRoleErr}
          onConfirm={doDeleteRole}
          onClose={() => { setConfirmDelRole(null); setDelRoleErr(null); }}
        />
      )}
      {detail && <RoleDetail role={detail} roleLang={effLib} onClose={() => setDetail(null)} onChat={(seed, r) => onPlainChat?.(seed, r)} demo={demo} onInstallPrompt={onInstallPrompt} />}
      {preview && (
        <ComposePreview
          result={preview.result}
          meta={preview.meta}
          loadingMeta={preview.loading}
          provider={provider}
          onRun={onRun}
          onSaveTeam={saveTeamNamed}
          defaultTeamName={teamName.trim() || preview.meta?.name}
          onClose={() => setPreview(null)}
          onGoToWorkflows={
            onGoToWorkflows
              ? () => {
                  setPreview(null);
                  onGoToWorkflows();
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
