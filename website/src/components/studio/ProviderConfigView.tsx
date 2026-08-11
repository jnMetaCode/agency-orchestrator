import { ArrowLeft, Check, Download, ExternalLink, Eye, EyeOff, Loader2, Plug, Plus, TriangleAlert, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n/LanguageProvider";
import { api, CLI_RELAY_PRESETS, CUSTOM_PROVIDER_PRESETS, groupModelsByVendor, providerLogo, type CliRelayPreset, type ConfigResponse } from "@/lib/studio";
import { sponsors, sponsorUrl } from "@/content/sponsors";
import { Tip } from "@/components/ui/tip";
import { track } from "@/lib/track";
import { cn } from "@/lib/utils";

/**
 * 全屏"配置供应商"视图（CC Switch 风格的独立页）：主列表只留紧凑行,所有输入
 * （key/base_url/模型/测试连接/CLI 中转/添加自定义）都收进这里。
 * 四种形态共用一个视图,按 target.kind 渲染对应表单;字段按「基本信息/连接配置/模型」
 * 分区成卡片,底部固定操作栏。
 */
export type ConfigTarget =
  | { kind: "api"; id: string; name: string; hint?: string; defaultBaseUrl?: string; suggestions?: string[]; isCustom?: boolean; customMeta?: { note?: string; homepageUrl?: string }; signupUrl?: string }
  // initialBaseUrl：从主列表的中转商行进来时预填该中转商的端点
  // initial{Sonnet,Opus,Haiku,}Model：预设自带模型映射时（如声算云那种带前缀命名的中转），
  // 选中转即预填三档 → 对齐 cc-switch「选预设=模型也填好」的零手填体验
  | { kind: "cli-relay"; id: string; name: string; globalWrite?: boolean; initialBaseUrl?: string; initialSonnetModel?: string; initialOpusModel?: string; initialHaikuModel?: string; initialModel?: string }
  | { kind: "ollama" }
  // prefill：从某个供应商「复制为供应商」时带过来的预填值（品牌端点 + 选定模型 + 建议名/标识）
  | { kind: "add-custom"; prefill?: { id?: string; name?: string; baseUrl?: string; model?: string; note?: string } };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border/70 bg-card/40 p-4 sm:p-5">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function ProviderConfigView({
  target,
  status,
  relayPresets = CLI_RELAY_PRESETS,
  onClose,
  onSaved,
}: {
  target: ConfigTarget;
  status?: ConfigResponse["providers"][string];
  /** CLI 中转商预设（内置 + 远程清单增量,由父组件合并传入） */
  relayPresets?: CliRelayPreset[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, lang } = useLanguage();
  const p = t.studio.providers;
  const isAdd = target.kind === "add-custom";
  const isRelay = target.kind === "cli-relay";
  const isOllama = target.kind === "ollama";
  const isEditCustom = target.kind === "api" && !!target.isCustom;
  // 「复制为供应商」带来的预填（新建自定义供应商时用品牌端点+选定模型打底）
  const addPrefill = target.kind === "add-custom" ? target.prefill : undefined;

  // 通用字段（中转商行进来时 initialBaseUrl 优先——用户点的就是"用这家"，即使之前存过别家）
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(
    (isRelay && (target as { initialBaseUrl?: string }).initialBaseUrl) || status?.baseUrl || addPrefill?.baseUrl || (isOllama ? "http://localhost:11434" : ""),
  );
  // 模型初值与 baseUrl 同一先例：从中转预设行进来时预设优先（用户点的就是"用这家"），
  // 其次已保存配置，最后空。注意不能用 ??——存过一次空字符串就会永远吞掉预设预填。
  const relayInit = isRelay ? (target as { initialSonnetModel?: string; initialOpusModel?: string; initialHaikuModel?: string; initialModel?: string }) : {};
  const [model, setModel] = useState(relayInit.initialModel || status?.model || addPrefill?.model || "");
  // claude-code 中转的模型映射（Sonnet/Opus/Haiku 档位 → 中转商实际模型，对齐 cc-switch）
  const isCcRelay = isRelay && target.kind === "cli-relay" && target.id === "claude-code";
  const [sonnetModel, setSonnetModel] = useState(relayInit.initialSonnetModel || status?.sonnetModel || "");
  const [opusModel, setOpusModel] = useState(relayInit.initialOpusModel || status?.opusModel || "");
  const [haikuModel, setHaikuModel] = useState(relayInit.initialHaikuModel || status?.haikuModel || "");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backups, setBackups] = useState<string[] | null>(null);

  // add-custom / edit-custom 共用的元数据字段（编辑内置供应商时这些是只读展示,不用 state）
  const [customId, setCustomId] = useState(addPrefill?.id ?? "");
  const [customName, setCustomName] = useState(isEditCustom ? (target as { name: string }).name : (addPrefill?.name ?? ""));
  const [note, setNote] = useState(isEditCustom ? ((target as { customMeta?: { note?: string } }).customMeta?.note ?? "") : (addPrefill?.note ?? ""));
  const [homepageUrl, setHomepageUrl] = useState(isEditCustom ? ((target as { customMeta?: { homepageUrl?: string } }).customMeta?.homepageUrl ?? "") : "");

  // 模型列表拉取
  const [fetchedModels, setFetchedModels] = useState<string[] | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // needsKey=true 时,fetchError 是「先填 key 再拉列表」的操作引导(非真失败)——用琥珀色而非报错红,
  // 且下方常用模型仍可直接点选,避免用户误以为坏了(部分聚合商的 /models 需鉴权,如多元探索)。
  const [fetchNeedsKey, setFetchNeedsKey] = useState(false);
  // 模型列表搜索词（大列表时用来筛几百个模型）
  const [modelFilter, setModelFilter] = useState("");

  // 从本机 cc-switch 一键导入 key（对齐 cc-switch 深链接「直接带 key 导入」的思路，
  // 数据源换成 ~/.cc-switch 本机库）。后端探测不到库/没有带 key 的条目时按钮不出现。
  const [ccEntries, setCcEntries] = useState<{ id: string; name: string; appType: string; baseUrl: string; keyPreview: string; isCurrent: boolean }[]>([]);
  const [ccOpen, setCcOpen] = useState(false);
  const [ccImported, setCcImported] = useState<string | null>(null);
  useEffect(() => {
    api.ccswitchProviders().then((r) => { if (r.ok && r.providers?.length) setCcEntries(r.providers); }).catch(() => {});
  }, []);
  const importFromCc = async (sourceId: string) => {
    try {
      // key 全程留在后端；claude-code 中转与 cc-switch 同为 Anthropic 协议根地址，连 base 一起导
      const r = await api.ccswitchImport({ source: sourceId, provider: providerId, includeBaseUrl: isCcRelay });
      if (r.ok) { setCcImported(r.keyPreview || ""); setCcOpen(false); onSaved(); }
    } catch (e: any) {
      setError(e?.message || String(e));
      setCcOpen(false);
    }
  };

  // 测试连接
  const [test, setTest] = useState<{ status: "idle" | "testing" | "ok" | "fail"; msg?: string }>({ status: "idle" });

  const providerId = target.kind === "api" || target.kind === "cli-relay" ? target.id : target.kind === "ollama" ? "ollama" : customId.trim();
  const displayTitle = isAdd ? p.addCustomProvider : target.kind === "ollama" ? "Ollama" : (target as { name: string }).name;
  const avatarChar = (isAdd ? (customName || "+") : displayTitle).slice(0, 1).toUpperCase();
  const logo = !isAdd ? providerLogo(providerId) : undefined;
  // base_url 输入的 placeholder：内置供应商显示真实默认端点,一眼知道留空会用什么
  const baseUrlPlaceholder =
    target.kind === "api" && target.defaultBaseUrl ? target.defaultBaseUrl
    : isOllama ? "http://localhost:11434"
    : p.customProviderBaseUrlPlaceholder;
  // claude 走原生 SDK,不支持自定义 base_url(后端 KEY_ENV base: null),隐藏该输入
  const supportsBaseUrl = target.kind === "api" ? status?.supportsBaseUrl !== false : true;
  const hintIsUrl = target.kind === "api" && !!target.hint && /^https?:\/\//.test(target.hint);
  // 注册直跳(右上角):API 类赞助商用自己的推广链接;中转配置页在选中某家中转商端点时用它的
  // Anthropic 协议中转商（provider: claude + 中转 base_url 直连）。这些中转商不是
  // OpenAI 兼容的，进不了 API_PROVIDERS，只能挂在 Claude 这个原生 SDK provider 上。
  const anthropicRelays = providerId === "claude" ? relayPresets.filter((r) => r.anthropicApiBaseUrl) : [];
  const registerUrl =
    target.kind === "api"
      ? anthropicRelays.find((r) => r.signupUrl && r.anthropicApiBaseUrl === baseUrl)?.signupUrl ?? target.signupUrl
    : isRelay ? relayPresets.find((r) => r.signupUrl && r.baseUrls[providerId] === baseUrl)?.signupUrl
    : undefined;
  // 赞助商优惠信息（对齐 cc-switch 的合作伙伴提示条）：优惠文案/优惠码之前只在官网赞助商页,
  // 配 key 时看不见 —— 现在直接展示在 API Key 输入框下方。数据复用 content/sponsors.ts,
  // 不再维护第二份。优云智算的 sponsor id 是 youyun、provider id 是 compshare,单独映射。
  const sponsorEntry = !isAdd
    ? sponsors.find((s) => s.id === (providerId === "compshare" ? "youyun" : providerId))
    : undefined;

  const applyPreset = (preset: (typeof CUSTOM_PROVIDER_PRESETS)[number]) => {
    setCustomName(preset.name);
    setBaseUrl(preset.baseUrl);
    if (!customId.trim()) {
      const suggested = preset.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
      if (/^[a-z]/.test(suggested)) setCustomId(suggested);
    }
  };

  const fetchModels = async () => {
    setFetchingModels(true);
    setFetchError(null);
    setFetchNeedsKey(false);
    try {
      // 输入框留空时，回退到该供应商前端已知的默认端点（API_PROVIDERS.defaultBaseUrl）并显式发给后端 ——
      // 这样即便后端 dist 尚未认识某个新增供应商（未重启/未重编），也不会因 spec 缺失、base 解析为空而 400，
      // 前端始终能自带 base。（对齐 cc-switch：base 缺失时无法拼 /models 候选。）
      const knownBase = target.kind === "api" ? target.defaultBaseUrl : undefined;
      // claude-code 中转端点是 Anthropic 协议根路径（如 api.cubence.com），
      // 模型列表在 /v1/models —— 给 base 补 /v1 并声明 anthropic 协议
      const rawBase = (baseUrl.trim() || knownBase || "").replace(/\/+$/, "");
      const effBase = isCcRelay && rawBase && !/\/v1$/.test(rawBase) ? `${rawBase}/v1` : rawBase;
      const r = await api.providerModels({
        provider: isAdd ? undefined : providerId,
        baseUrl: effBase || undefined,
        apiKey: key.trim() || undefined,
        protocol: isCcRelay ? "anthropic" : undefined,
      });
      if (r.ok && r.models) setFetchedModels(r.models);
      // 没填 key 又被中转拒绝(401/未设置 key)时,别把原始 JSON 甩给用户,给一句可操作的引导
      else if (!key.trim() && /401|403|未设置 API key|authentication|credential|invalid token/i.test(r.error || "")) { setFetchNeedsKey(true); setFetchError(p.fetchNeedsKey); }
      else setFetchError(r.error || "failed");
    } catch (e: any) {
      setFetchError(e?.message || String(e));
    } finally {
      setFetchingModels(false);
    }
  };

  const runTest = async () => {
    setTest({ status: "testing" });
    try {
      // 带上当前输入框里的值:填了就能测,不用先保存
      const r = await api.testProvider(providerId, {
        apiKey: key.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
        model: model.trim() || undefined,
      });
      setTest(r.ok ? { status: "ok", msg: r.note || `${r.latencyMs}ms` } : { status: "fail", msg: r.error });
    } catch (e: any) {
      setTest({ status: "fail", msg: e?.message });
    }
  };

  const save = async () => {
    setError(null);
    if (isAdd) {
      if (!customId.trim()) return setError(p.customProviderIdRequired);
      if (!customName.trim()) return setError(p.customProviderNameRequired);
      if (!baseUrl.trim()) return setError(p.customProviderBaseUrlRequired);
      setSaving(true);
      try {
        await api.createCustomProvider({
          id: customId.trim(),
          name: customName.trim(),
          note: note.trim() || undefined,
          homepageUrl: homepageUrl.trim() || undefined,
          baseUrl: baseUrl.trim(),
          apiKey: key.trim() || undefined,
          model: model.trim() || undefined,
        });
        onSaved();
        onClose();
      } catch (e: any) {
        setError(e?.message || String(e));
      } finally {
        setSaving(false);
      }
      return;
    }
    if (isRelay && (target as { globalWrite?: boolean }).globalWrite && !window.confirm(p.cliRelayGlobalConfirm)) return;
    setSaving(true);
    try {
      // 编辑自定义供应商时,名称/官网/备注这些元数据也一起保存
      if (isEditCustom) {
        if (!customName.trim()) { setError(p.customProviderNameRequired); setSaving(false); return; }
        await api.updateCustomProvider(providerId, { name: customName.trim(), note, homepageUrl });
      }
      const r = await api.saveConfig(
        isOllama ? { provider: "ollama", baseUrl, model }
        // claude-code 中转：默认模型 + 三档映射一起保存（空串=清掉该档）
        : isCcRelay ? { provider: providerId, apiKey: key, baseUrl, model, sonnetModel, opusModel, haikuModel }
        : { provider: providerId, apiKey: key, baseUrl, model: isRelay ? undefined : model },
      );
      setKey("");
      // 后端会规整地址（如把误贴的 .../v1/chat/completions 收成 .../v1）——回填，
      // 否则输入框还显示原文，用户以为没生效
      if (typeof r.baseUrl === "string" && r.baseUrl !== baseUrl) setBaseUrl(r.baseUrl);
      setBackups(r.backups && r.backups.length > 0 ? r.backups : null);
      onSaved();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    try {
      await api.saveConfig({ provider: providerId, apiKey: "" });
      setKey("");
      setBaseUrl("");
      setModel("");
      setBackups(null);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "h-10 w-full rounded-xl border border-border/70 bg-background px-3 text-sm outline-none focus:border-primary/50";
  const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";
  const modelChips = fetchedModels ?? (target.kind === "api" ? target.suggestions ?? [] : []);
  // 聚合站一拉就是几百个模型，平铺没法选 —— 大列表时给个搜索框先筛（对齐 cc-switch 的可搜下拉体验）。
  const filteredChips = modelFilter.trim()
    ? modelChips.filter((m) => m.toLowerCase().includes(modelFilter.trim().toLowerCase()))
    : modelChips;

  // 生效配置预览（对齐 cc-switch 的「配置 JSON」透明度）：AO 不写全局配置文件，
  // 注入的是 AO 所启动 CLI 子进程的环境变量——预览的就是保存后实际生效的那份 env。
  const envPreview = isCcRelay
    ? JSON.stringify(
        {
          env: {
            ANTHROPIC_BASE_URL: baseUrl.trim() || undefined,
            ANTHROPIC_AUTH_TOKEN: key.trim() ? "••••••" : status?.hasKey ? p.envPreviewSaved : undefined,
            ...(model.trim() ? { ANTHROPIC_MODEL: model.trim() } : {}),
            ...(sonnetModel.trim() ? { ANTHROPIC_DEFAULT_SONNET_MODEL: sonnetModel.trim() } : {}),
            ...(opusModel.trim() ? { ANTHROPIC_DEFAULT_OPUS_MODEL: opusModel.trim() } : {}),
            ...(haikuModel.trim() ? { ANTHROPIC_DEFAULT_HAIKU_MODEL: haikuModel.trim() } : {}),
          },
        },
        null,
        2,
      )
    : "";

  return (
    <div className="fixed inset-0 z-[58] overflow-auto bg-background">
      {/* 顶栏：返回 + 头像 + 标题 */}
      <div className="sticky top-0 z-10 border-b border-border/60 bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <Tip label={p.backToList}>
            <button onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-xl border border-border/70 text-muted-foreground hover:text-foreground" aria-label={p.backToList}>
              <ArrowLeft className="size-4" />
            </button>
          </Tip>
          {logo ? (
            <img src={logo} alt="" className="size-9 shrink-0 rounded-xl object-contain" onError={(e) => (e.currentTarget.style.display = "none")} />
          ) : (
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary/80 to-fuchsia-500/80 text-sm font-bold text-white">
              {avatarChar}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold leading-tight">{isAdd ? p.addCustomProvider : `${p.editProviderTitle} · ${displayTitle}`}</h2>
            {target.kind === "api" && target.hint && (
              hintIsUrl ? (
                <a href={target.hint} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate text-[11px] text-primary hover:underline">
                  {target.hint} <ExternalLink className="size-2.5 shrink-0" />
                </a>
              ) : (
                <p className="truncate text-[11px] text-muted-foreground">{target.hint}</p>
              )
            )}
          </div>
          {/* 右上角注册直跳:没 key 的用户最需要的入口 */}
          {registerUrl && (
            <a
              href={registerUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => track("sponsor_click", { sponsor: providerId, surface: "provider_register_cta" })}
              className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-gold px-3 py-2 text-xs font-semibold text-gold-foreground transition-opacity hover:opacity-90"
            >
              {p.registerCta} <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      </div>

      {/* 内容区 */}
      <div>
        <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
          {/* 基本信息：内置=只读展示,自定义=可编辑 */}
          {target.kind === "api" && !isAdd && (
            <Section title={p.sectionBasicInfo}>
              {isEditCustom ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>{p.customProviderIdLabel}</label>
                      <input value={target.id} disabled className={cn(inputCls, "cursor-not-allowed opacity-60")} />
                      <p className="mt-1 text-[11px] text-muted-foreground">{p.idImmutableHint}</p>
                    </div>
                    <div>
                      <label className={labelCls}>{p.customProviderNameLabel} *</label>
                      <input value={customName} onChange={(e) => setCustomName(e.target.value)} className={inputCls} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>{p.customProviderHomepageLabel}</label>
                      <input value={homepageUrl} onChange={(e) => setHomepageUrl(e.target.value)} placeholder="https://example.com" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>{p.customProviderNoteLabel}</label>
                      <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
                    </div>
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className={labelCls}>{p.customProviderIdLabel}</span>
                    <code className="text-xs">{target.id}</code>
                  </div>
                  {target.defaultBaseUrl && (
                    <div className="min-w-0">
                      <span className={labelCls}>{p.defaultEndpointLabel}</span>
                      <code className="block truncate text-xs">{target.defaultBaseUrl}</code>
                    </div>
                  )}
                </div>
              )}
            </Section>
          )}
          {/* add-custom：预设图库 + 基本信息 */}
          {isAdd && (
            <>
              {/* 表单看着"太简单"是有意为之：协议定死 OpenAI 兼容，把这个边界说出来，
                  用户才不会怀疑"填个 key 和地址怎么可能够" */}
              <p className="rounded-xl border border-border/60 bg-muted/40 px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground">
                💡 {p.customProviderProtocolHint}
              </p>
              <Section title={p.customProviderPresetsLabel}>
                <div className="flex flex-wrap gap-1.5">
                  {CUSTOM_PROVIDER_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs transition-colors",
                        baseUrl === preset.baseUrl ? "border-primary bg-primary/10 text-primary" : "border-border/70 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                      )}
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </Section>
              <Section title={p.sectionBasicInfo}>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>{p.customProviderIdLabel} *</label>
                    <input value={customId} onChange={(e) => setCustomId(e.target.value)} placeholder={p.customProviderIdPlaceholder} className={inputCls} />
                    <p className="mt-1 text-[11px] text-muted-foreground">{p.customProviderIdHint}</p>
                  </div>
                  <div>
                    <label className={labelCls}>{p.customProviderNameLabel} *</label>
                    <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder={p.customProviderNamePlaceholder} className={inputCls} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>{p.customProviderHomepageLabel}</label>
                    <input value={homepageUrl} onChange={(e) => setHomepageUrl(e.target.value)} placeholder="https://example.com" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>{p.customProviderNoteLabel}</label>
                    <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
                  </div>
                </div>
              </Section>
            </>
          )}

          {/* CLI 中转说明 + codex 全局警告 + 中转商预设 */}
          {isRelay && (
            <Section title={p.cliRelayToggle}>
              <p className="text-xs text-muted-foreground">{p.cliRelayHint}</p>
              {(target as { globalWrite?: boolean }).globalWrite && (
                <p className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {p.cliRelayGlobalWarning}
                </p>
              )}
              {backups && (
                <p className="text-[11px] text-muted-foreground">
                  {p.cliRelayBackedUp} {backups.map((b) => b.split("/").pop()).join(", ")}
                </p>
              )}
              {relayPresets.some((r) => r.baseUrls[providerId]) && (
                <div>
                  <label className={labelCls}>{p.cliRelayPresetsLabel}</label>
                  <div className="flex flex-wrap gap-1.5">
                    {relayPresets.filter((r) => r.baseUrls[providerId]).map((r) => (
                      <button
                        key={r.name}
                        type="button"
                        onClick={() => setBaseUrl(r.baseUrls[providerId])}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                          baseUrl === r.baseUrls[providerId]
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border/70 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                        )}
                      >
                        {r.name}
                        {r.sponsor && (
                          <span className="rounded-full bg-muted px-1 py-px text-[9px] font-medium text-muted-foreground">
                            {p.sponsorTag}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Section>
          )}

          {/* 连接配置：base_url + key */}
          <Section title={p.sectionConnection}>
            {/* Anthropic 协议中转商一键填地址：这类中转商不是 OpenAI 兼容，只能挂在
                Claude 这个原生 SDK provider 上，端点各家不同（子路径而非根路径），手填极易错 */}
            {anthropicRelays.length > 0 && (
              <div>
                <label className={labelCls}>{p.anthropicRelayPresetsLabel}</label>
                <div className="flex flex-wrap gap-1.5">
                  {anthropicRelays.map((r) => (
                    <button
                      key={r.name}
                      type="button"
                      onClick={() => setBaseUrl(r.anthropicApiBaseUrl!)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                        baseUrl === r.anthropicApiBaseUrl
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border/70 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                      )}
                    >
                      {r.name}
                      {r.sponsor && (
                        <span className="rounded-full bg-muted px-1 py-px text-[9px] font-medium text-muted-foreground">
                          {p.sponsorTag}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">{p.anthropicRelayHint}</p>
              </div>
            )}
            {supportsBaseUrl && (
              <div>
                <label className={labelCls}>
                  {isRelay ? p.cliRelayBaseUrlPlaceholder : p.customProviderBaseUrlLabel}
                  {isAdd && " *"}
                  {target.kind === "api" && target.defaultBaseUrl && (
                    <span className="ml-2 font-normal text-muted-foreground/70">{p.baseUrlDefaultHint}</span>
                  )}
                </label>
                <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={baseUrlPlaceholder} className={cn(inputCls, "font-mono")} />
                {/* Azure 部署地址少了 ?api-version= 必 404，且报错只说 404 很难联想到这一点 */}
                {/azure/i.test(baseUrl) && !/[?&]api-version=/i.test(baseUrl) && (
                  <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">{p.azureApiVersionHint}</p>
                )}
              </div>
            )}
            {!isOllama && (
              <div>
                <label className={labelCls}>
                  {isRelay ? p.cliRelayTokenPlaceholder : "API Key"}
                  {status?.hasKey && <span className="ml-2 text-emerald-500">{p.keySet}{status.fromEnv ? p.fromEnv : ""}</span>}
                </label>
                <div className="relative">
                  <input
                    type={show ? "text" : "password"}
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder={status?.hasKey ? p.pasteNewKey : p.pasteKey}
                    className={cn(inputCls, "pr-9 font-mono")}
                  />
                  <Tip label={show ? p.hideKey : p.showKey} className="absolute right-2 top-1/2 -translate-y-1/2">
                    <button type="button" onClick={() => setShow((v) => !v)} className="text-muted-foreground hover:text-foreground">
                      {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </Tip>
                </div>
                {/* 获取 key 独立行（对齐 cc-switch 合作伙伴提示条）：优惠文案 + 优惠码 + 直达链接 */}
                {(sponsorEntry || registerUrl) && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-xl border border-gold/40 bg-gold/[0.06] px-3 py-2">
                    <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-foreground/85">
                      💡 {sponsorEntry?.perk?.[lang] ?? p.getKeyGeneric}
                      {sponsorEntry?.couponCode && (
                        <>
                          {" · "}{p.couponLabel}
                          <code className="ml-1 rounded bg-gold/15 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-gold">{sponsorEntry.couponCode}</code>
                        </>
                      )}
                    </p>
                    <a
                      href={sponsorEntry ? sponsorUrl(sponsorEntry, lang) : registerUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => track("sponsor_click", { sponsor: sponsorEntry?.id ?? providerId, surface: "provider_perk" })}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-gold/15 px-2.5 py-1 text-xs font-semibold text-gold transition-colors hover:bg-gold/25"
                    >
                      {p.getApiKey} <ExternalLink className="size-3" />
                    </a>
                  </div>
                )}
                {/* 本机 cc-switch 已有配好的 key → 一键导入,不用再复制粘贴（key 不经过浏览器） */}
                {ccEntries.length > 0 && !isAdd && (
                  <div className="mt-1.5">
                    {ccImported ? (
                      <p className="text-[11px] text-emerald-500">
                        <Check className="mr-0.5 inline size-3" />
                        {p.ccswitchImported}（{ccImported}）
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setCcOpen((v) => !v)}
                        className="flex items-center gap-1 rounded-lg border border-border/70 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                      >
                        <Download className="size-3" /> {p.ccswitchImport}
                      </button>
                    )}
                    {ccOpen && !ccImported && (
                      <div className="mt-1.5 space-y-1 rounded-xl border border-border/60 bg-muted/20 p-2">
                        <p className="text-[11px] text-muted-foreground">{p.ccswitchPick}</p>
                        {ccEntries.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => importFromCc(c.id)}
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-muted"
                          >
                            <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                            <span className="shrink-0 text-muted-foreground">{c.appType}</span>
                            {c.baseUrl && <span className="hidden max-w-[180px] shrink-0 truncate font-mono text-muted-foreground/70 sm:inline">{c.baseUrl.replace(/^https?:\/\//, "")}</span>}
                            <span className="shrink-0 font-mono text-muted-foreground/70">{c.keyPreview}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* claude-code 中转的模型映射（对齐 cc-switch）：Sonnet/Opus/Haiku 档位 →
              中转商实际上架的模型；「获取模型列表」直接从中转端点拉真实清单填 datalist */}
          {isCcRelay && (
            <Section title={p.sectionModelMap}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs text-muted-foreground">{p.modelMapHint}</p>
                <button
                  type="button"
                  onClick={fetchModels}
                  disabled={fetchingModels}
                  title={p.fetchModelsHint}
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-border/70 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  {fetchingModels ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
                  {p.fetchModels}
                </button>
              </div>
              {fetchError && <p className={cn("text-[11px]", fetchNeedsKey ? "text-amber-500" : "text-red-500")}>{fetchError}</p>}
              {fetchedModels && (
                <p className="text-[11px] text-muted-foreground">{p.modelsFetchedPre}{fetchedModels.length}{p.modelsFetchedPost}</p>
              )}
              <datalist id="cc-relay-models">
                {(fetchedModels ?? []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              {[
                { label: "Sonnet", env: "ANTHROPIC_DEFAULT_SONNET_MODEL", val: sonnetModel, set: setSonnetModel },
                { label: "Opus", env: "ANTHROPIC_DEFAULT_OPUS_MODEL", val: opusModel, set: setOpusModel },
                { label: "Haiku", env: "ANTHROPIC_DEFAULT_HAIKU_MODEL", val: haikuModel, set: setHaikuModel },
                { label: p.modelMapDefaultLabel, env: "ANTHROPIC_MODEL", val: model, set: setModel },
              ].map((row) => (
                <div key={row.env} className="grid grid-cols-[92px_1fr] items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">{row.label}</span>
                  <input
                    list="cc-relay-models"
                    value={row.val}
                    onChange={(e) => row.set(e.target.value)}
                    placeholder={row.env}
                    autoComplete="off"
                    className={cn(inputCls, "font-mono text-xs")}
                  />
                </div>
              ))}
            </Section>
          )}

          {/* 生效配置预览：保存后注入 AO 所启动 CLI 的环境变量（只读,不写全局配置文件） */}
          {isCcRelay && (
            <Section title={p.sectionEnvPreview}>
              <p className="text-xs text-muted-foreground">{p.envPreviewHint}</p>
              <pre className="overflow-x-auto rounded-xl border border-border/60 bg-muted/30 p-3 font-mono text-xs leading-relaxed text-foreground/90">{envPreview}</pre>
            </Section>
          )}

          {/* 模型（其余中转不需要——中转商用 CLI 自己的模型协商） */}
          {!isRelay && (
            <Section title={p.sectionModel}>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className={labelCls + " mb-0"}>{isOllama ? p.ollamaModelPlaceholder : p.modelPlaceholder}</label>
                  {!isOllama && (
                    <button
                      type="button"
                      onClick={fetchModels}
                      disabled={fetchingModels}
                      title={p.fetchModelsHint}
                      className="flex items-center gap-1 rounded-lg border border-border/70 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      {fetchingModels ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
                      {p.fetchModels}
                    </button>
                  )}
                </div>
                <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={p.customProviderModelPlaceholder} autoComplete="off" className={inputCls} />
                {fetchError && <p className={cn("mt-1 text-[11px]", fetchNeedsKey ? "text-amber-500" : "text-red-500")}>{fetchError}</p>}
                {fetchedModels && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {p.modelsFetchedPre}{fetchedModels.length}{p.modelsFetchedPost}
                  </p>
                )}
                {/* 模型多时给个搜索框先筛（聚合站常几百个），筛完再点选 */}
                {modelChips.length > 8 && (
                  <input
                    value={modelFilter}
                    onChange={(e) => setModelFilter(e.target.value)}
                    placeholder={p.modelFilterPlaceholder}
                    autoComplete="off"
                    className={cn(inputCls, "mt-1.5 h-8 text-xs")}
                  />
                )}
                {modelChips.length > 0 && filteredChips.length === 0 && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">{p.modelFilterNoMatch}</p>
                )}
                {filteredChips.length > 0 &&
                  (filteredChips.length > 12 ? (
                    // 大列表(通常是拉到的真实全量):按厂商分组,像 cc-switch 那样可扫读,不再一堆平铺
                    <div className="mt-1.5 max-h-60 space-y-2 overflow-auto pr-1">
                      {groupModelsByVendor(filteredChips).map(([vendor, ms]) => (
                        <div key={vendor}>
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                            {vendor} · {ms.length}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {ms.map((m) => (
                              <button
                                key={m}
                                type="button"
                                onClick={() => setModel(m)}
                                className={cn(
                                  "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                                  model === m ? "border-primary bg-primary/10 text-primary" : "border-border/70 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                                )}
                              >
                                {m}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-1.5 flex max-h-44 flex-wrap gap-1.5 overflow-auto">
                      {filteredChips.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setModel(m)}
                          className={cn(
                            "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                            model === m ? "border-primary bg-primary/10 text-primary" : "border-border/70 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                          )}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  ))}
              </div>
            </Section>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}

          {/* 操作行：跟在内容后面,不悬空 */}
          <div className="flex items-center gap-3 pt-1">
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : isAdd ? <Plus className="size-4" /> : null}
              {isAdd ? p.customProviderSubmit : p.save}
            </Button>
            {/* gemini/codex 中转走各自 CLI 的原生协议，用 OpenAI 格式去测会误报失败，仍不显示；
                claude-code 中转后端已按 Anthropic 协议（POST {base}/v1/messages）实测，可以放开 */}
            {!isAdd && (!isRelay || isCcRelay) && (
              <Button size="sm" variant="outline" onClick={runTest} disabled={test.status === "testing"}>
                {test.status === "testing" ? <Loader2 className="size-3.5 animate-spin" /> : <Plug className="size-3.5" />}
                {p.testConnection}
              </Button>
            )}
            {test.status === "ok" && (
              <span className="inline-flex min-w-0 items-start gap-1 text-xs text-emerald-500">
                <Check className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0 break-words">{p.ok} · {test.msg}</span>
              </span>
            )}
            {test.status === "fail" && (
              <span className="inline-flex min-w-0 items-start gap-1 text-xs text-red-500">
                <XCircle className="mt-0.5 size-3.5 shrink-0" />
                {/* 失败原因常带多行排查指引(实际请求地址/跳转/该改哪里)——按行显示,超长可滚动 */}
                <span className="max-h-40 min-w-0 overflow-y-auto whitespace-pre-line break-words" title={test.msg}>{test.msg}</span>
              </span>
            )}
            {!isAdd && !isOllama && status?.hasKey && !status.fromEnv && (
              <button onClick={clear} className="ml-auto text-xs text-muted-foreground hover:text-red-500">
                {p.clear}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
