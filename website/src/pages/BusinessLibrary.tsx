import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useLanguage } from "@/i18n/LanguageProvider";
import manifest from "../../public/business-data/manifest.json";
import { SiteFooter } from "@/components/layout/SiteFooter";

type Kind = "companies" | "investors" | "contacts" | "arr";
type Row = Record<string, string> & { id: string; chunk?: number };
const kinds: Kind[] = ["companies", "investors", "contacts", "arr"];
const labels: Record<Kind, [string, string]> = { companies: ["公司库", "Companies"], investors: ["投资机构", "Investors"], contacts: ["投资人", "Contacts"], arr: ["ARR 榜单", "ARR leaderboard"] };
const columns: Record<Kind, string[]> = { companies: ["name", "country", "industries", "employees_est", "status"], investors: ["name", "type", "hq", "ai_deals_2026", "contacts_count"], contacts: ["name", "firm", "title", "ai_focus", "email_status"], arr: ["rank", "company", "category", "arr_usd", "arr_kind", "arr_as_of"] };
const fieldNames: Record<string, string> = { name:"名称", country:"国家", industries:"行业", employees_est:"员工估计数", status:"状态", type:"机构类型", hq:"所在地", ai_deals_2026:"2026 AI 投资数", contacts_count:"联系人数量", firm:"所属机构", title:"职位", ai_focus:"AI 方向", email_status:"邮箱来源状态", rank:"排名", company:"公司", category:"类别", arr_usd:"ARR（美元）", arr_kind:"ARR 口径", arr_as_of:"ARR 数据日期", website:"官网", firm_website:"机构官网", linkedin:"LinkedIn", lounge_url:"原始资料", source_url:"指标来源链接", description:"简介", long_description:"详细介绍", email:"邮箱", contact_email:"机构邮箱", phone:"电话", contact_phone:"机构电话", founded:"成立年份", valuation_usd:"估值（美元）", revenue_usd:"营收（美元）", revenue_source:"营收来源", record_origin:"资料来源", investor_names:"投资机构", raised_2026_usd:"2026 融资（美元）", latest_stage:"最近融资阶段", last_round_on:"最近融资日期", valuation_to_arr:"估值 / ARR", arr_per_employee_usd:"人均 ARR（美元）", notes:"备注", source:"来源" };
const cache = new Map<string, Promise<Row[]>>();
function loadRows(file: string): Promise<Row[]> {
  if (!cache.has(file)) cache.set(file, fetch(`/business-data/${file}.json`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).catch(e => { cache.delete(file); throw e; }));
  return cache.get(file)!;
}
function display(key: string, value: string) {
  if (!value) return "—";
  if (key.endsWith("_usd") && Number.isFinite(Number(value))) return new Intl.NumberFormat("en-US", { style:"currency", currency:"USD", maximumFractionDigits:0 }).format(Number(value));
  if (key === "arr_kind") return value === "estimate" ? "估算 / Estimate" : "报告值 / Reported";
  if (key === "record_origin") return value === "contacts" ? "联系人资料补建" : "机构资料";
  return value;
}
export default function BusinessLibrary() {
  const { lang, prefix } = useLanguage(); const en = lang === "en";
  const { dataset } = useParams();
  const navigate = useNavigate();
  function go(target: Kind, values: Record<string,string> = {}) { const search = new URLSearchParams(values).toString(); navigate(`${prefix(`/business/${target}`)}${search ? `?${search}` : ""}`); }
  const [params, setParams] = useSearchParams();
  const kind: Kind = kinds.includes(dataset as Kind) ? dataset as Kind : kinds.includes(params.get("tab") as Kind) ? params.get("tab") as Kind : "companies";
  const query = params.get("q") || ""; const filter = params.get("filter") || "";
  const [rows, setRows] = useState<Row[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [retry, setRetry] = useState(0);
  const [detail, setDetail] = useState<Row | null>(null); const [detailBusy, setDetailBusy] = useState(false);
  const requestId = useRef(0);
  const [detailError, setDetailError] = useState("");
  useEffect(() => { let active = true; setLoading(true); setError(""); setRows([]); setDetail(null); ++requestId.current; setDetailBusy(false); setDetailError("");
    loadRows(`${kind}-index`).then(data => { if (active) setRows(data); }).catch(e => { if (active) setError(String(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; }; }, [kind, retry]);
  useEffect(() => { document.title = en ? "AI Business Library | Agency Orchestrator" : "AI 商业库 | Agency Orchestrator"; }, [en]);
  useEffect(() => { if (detail) document.getElementById("business-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [detail?.id]);
  const filterKey = { companies:"country", investors:"type", contacts:"email_status", arr:"arr_kind" }[kind];
  const options = useMemo(() => [...new Set(rows.map(r => r[filterKey]).filter(Boolean))].sort(), [rows, filterKey]);
  const filtered = useMemo(() => rows.filter(r => (!filter || r[filterKey] === filter) && (!params.get("firm") || r.investor_id === params.get("firm")) && columns[kind].concat("industries", "title", "firm").some(k => (r[k] || "").toLowerCase().includes(query.trim().toLowerCase()))).sort((a,b) => { const sort = params.get("sort"); if (!sort) return 0; const av = a[sort], bv = b[sort]; if (!av) return 1; if (!bv) return -1; return Number(bv)-Number(av); }), [rows, kind, query, filter, filterKey, params]);
  const pages = Math.max(1, Math.ceil(filtered.length / 30)); const page = Math.max(1, Math.min(pages, Math.floor(Number(params.get("page"))) || 1));
  function change(values: Record<string, string>) { const next = new URLSearchParams(params); next.delete("page"); for (const [k,v] of Object.entries(values)) { if (v) next.set(k,v); else next.delete(k); } setParams(next); }
  async function inspect(row: Row) { const request = ++requestId.current; setDetail(row); setDetailBusy(true); setDetailError(""); try { const data = await loadRows(`${kind}-${row.chunk}`); const found = data.find(r => r.id === row.id); if (!found) throw new Error("Record missing"); setDetail(current => current?.id === row.id ? found : current); } catch(e) { if (request === requestId.current) setDetailError(String(e)); } finally { if (request === requestId.current) setDetailBusy(false); } }
  const inputClass = "rounded-xl border border-border bg-background px-3 py-2 text-sm";
  return <><main className="container-page min-h-screen pb-16 pt-28">
    <h1 className="text-3xl font-bold">{en ? "AI Business Library" : "AI 商业库"}</h1>
    <p className="mt-3 text-sm text-muted-foreground">{en ? "Company, investor and ARR data · October 2026 snapshot · Source: Lounge CSV exports." : "公司、投资机构、投资人与 ARR 数据 · 2026 年 10 月快照 · 来源：Lounge CSV 导出。"}</p>
    <p className="mt-2 text-xs text-muted-foreground">{en ? "Estimates and reported figures are distinguished. Email status is a source label, not independently verified." : "估算与报告值分别标记；邮箱状态沿用来源标记，未重新验证。机构列表包含从联系人资料补建的机构。"}</p>
    <div className="my-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={en ? "Business datasets" : "商业数据分类"}>{kinds.map(k => <Link key={k} to={prefix(`/business/${k}`)} aria-current={kind === k ? "page" : undefined} className={`rounded-2xl border p-5 transition-colors hover:border-primary ${kind === k ? "border-primary bg-primary/5" : "border-border bg-background"}`}>
      <div className="font-semibold">{labels[k][en ? 1 : 0]}</div>
      <div className="my-2 text-3xl font-bold tabular-nums">{manifest.datasets[k].count.toLocaleString(en ? "en-US" : "zh-CN")}</div>
      <p className="text-xs text-muted-foreground">{k === "companies" ? (en ? "Industries, locations and company profiles" : "行业、地区与公司资料") : k === "investors" ? (en ? "Includes firms added from contact records" : "包含从联系人资料补建的机构") : k === "contacts" ? (en ? "Deduplicated investor contact records" : "已合并重复联系人记录") : (en ? "All entries linked to company profiles" : "全部关联到公司资料")}</p>
      <span className="mt-3 block text-sm text-primary">{en ? "Browse list →" : "查看列表 →"}</span>
    </Link>)}</div>
    <h2 className="mb-4 text-xl font-semibold">{labels[kind][en ? 1 : 0]}</h2>
    <div className="mb-5 flex flex-wrap gap-3"><input aria-label={en ? "Search" : "搜索"} className={`${inputClass} min-w-64 flex-1`} placeholder={en ? "Search names, industries, positions…" : "搜索名称、行业、职位…"} value={query} onChange={e => change({q:e.target.value})}/><select aria-label={filterKey} className={inputClass} value={filter} onChange={e => change({filter:e.target.value})}><option value="">{en ? "All" : "全部"} · {en ? filterKey : fieldNames[filterKey]}</option>{options.map(v => <option key={v} value={v}>{display(filterKey,v)}</option>)}</select>{kind === "arr" && <select className={inputClass} aria-label={en ? "Sort" : "排序"} value={params.get("sort") || ""} onChange={e=>change({sort:e.target.value})}><option value="">{en ? "Rank order" : "按原始排名"}</option>{["arr_usd","valuation_to_arr","arr_per_employee_usd"].map(k=><option key={k} value={k}>{en ? k.replace(/_/g," ") : fieldNames[k]} ↓</option>)}</select>}{params.get("firm") && <button className={inputClass} onClick={() => change({firm:""})}>{en ? "Clear firm filter" : "取消机构限定"}</button>}</div>
    {loading ? <p role="status">{en ? "Loading…" : "正在加载…"}</p> : error ? <div role="alert">{en ? "Could not load data" : "数据加载失败"}：{error} <button className={inputClass} onClick={() => setRetry(x=>x+1)}>{en ? "Retry" : "重试"}</button></div> : <>
      <p className="mb-3 text-sm text-muted-foreground">{filtered.length.toLocaleString()} {en ? "records" : "条记录"}</p>
      <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-left text-sm"><thead className="bg-muted"><tr>{columns[kind].map(k => <th key={k} className="p-3">{en ? k.replace(/_/g," ") : fieldNames[k] || k}</th>)}<th className="p-3">{en ? "Details" : "详情"}</th></tr></thead><tbody>{filtered.slice((page-1)*30,page*30).map(r => <tr key={r.id} className="border-t border-border hover:bg-muted/40">{columns[kind].map(k => <td key={k} className="max-w-xs p-3">{display(k,r[k])}</td>)}<td className="p-3"><button className="whitespace-nowrap text-primary underline" onClick={() => inspect(r)}>{en ? "View" : "查看"}</button></td></tr>)}</tbody></table></div>
      {!filtered.length && <p className="py-8 text-center">{en ? "No matching records" : "没有匹配的记录"}</p>}
      <div className="mt-5 flex items-center justify-center gap-4"><button className={inputClass} disabled={page<=1} onClick={() => change({page:String(page-1)})}>{en ? "Previous" : "上一页"}</button><span>{page} / {pages}</span><button className={inputClass} disabled={page>=pages} onClick={() => change({page:String(page+1)})}>{en ? "Next" : "下一页"}</button></div>
    </>}
    {detail && <section id="business-detail" style={{ scrollMarginTop: 90 }} aria-label={en ? "Record details" : "记录详情"} className="mt-8 rounded-2xl border border-border p-5"><div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">{detail.name || detail.company}</h2><button className={inputClass} onClick={() => { ++requestId.current; setDetail(null); }}>{en ? "Close" : "关闭"}</button></div>
      {detailBusy && <p role="status">{en ? "Loading details…" : "正在加载详情…"}</p>}{detailError && <p role="alert">{detailError} <button className={inputClass} onClick={()=>inspect(detail)}>{en ? "Retry" : "重试"}</button></p>}
      <div className="my-4 flex flex-wrap gap-3">{kind === "investors" && <button className={inputClass} onClick={()=>go("contacts",{firm:detail.id})}>{en ? "View contacts" : "查看关联投资人"}</button>}{kind === "contacts" && <button className={inputClass} onClick={()=>go("investors",{q:detail.firm})}>{en ? "View firm" : "查看所属机构"}</button>}{kind === "arr" && detail.company_id && <button className={inputClass} onClick={()=>go("companies",{q:detail.company})}>{en ? "View company" : "查看公司资料"}</button>}{kind === "companies" && detail.arr_record_id && <button className={inputClass} onClick={()=>go("arr",{q:detail.name})}>{en ? "View ARR" : "查看 ARR 榜单"}</button>}</div>
      <dl className="grid gap-4 sm:grid-cols-2">{Object.entries(detail).filter(([k,v])=> v && !["id","chunk","investor_id","company_id","arr_record_id"].includes(k) && !/^partner\d_/.test(k)).map(([k,v]) => <div key={k} className="min-w-0"><dt className="text-xs text-muted-foreground">{en ? k.replace(/_/g," ") : fieldNames[k] || k}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm">{/^https?:\/\//i.test(String(v)) ? <a className="text-primary underline" href={String(v)} target="_blank" rel="noreferrer">{String(v)}</a> : display(k,String(v))}</dd></div>)}</dl>
    </section>}
  </main><SiteFooter/></>;
}
