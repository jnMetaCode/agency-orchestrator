import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/studio";

export type BackendStatus = "checking" | "online" | "offline";

export function useBackend() {
  const [status, setStatus] = useState<BackendStatus>("checking");
  const [version, setVersion] = useState<string | null>(null);
  // 引擎进程启动后代码被重新构建（server.js/dist 更新）→ 内存里跑的是旧代码，
  // 会出现"前端认识、引擎 unknown provider"之类的版本漂移——提示用户重启引擎
  const [stale, setStale] = useState(false);
  const [latest, setLatest] = useState<string | null>(null);

  // 连续失败次数：一次网络抖动就切到 offline 会让整个 Studio 换成离线视图，已填的任务、勾的角色全被卸载丢掉。
  // 连续 3 次（15 秒）没响应才算离线；首次检查除外（一开始就连不上要马上说）。
  const misses = useRef(0);
  const [blocked, setBlocked] = useState<string | null>(null);
  const check = useCallback(async () => {
    try {
      const h = await api.health();
      misses.current = 0;
      setBlocked(null);
      setVersion(h.version ?? null);
      setStale(h.stale === true);
      setLatest(h.latest ?? null);
      setStatus("online");
    } catch (e) {
      // 403 = 引擎在、但来源守卫把这次访问拦了（比如用域名访问没设 AO_ALLOWED_HOSTS）。这不是「没装引擎」，
      // 服务端的报错里写着该设哪个变量，得原样给用户看
      const msg = e instanceof Error ? e.message : String(e);
      // 403 = 来源守卫拦了；401 = 设了 AO_WEB_TOKEN 但这次没带对。两者都不是「没装引擎」，
      // 服务端的报错里写着该怎么办，原样给用户看
      if (/^40[13]\b/.test(msg)) { setBlocked(msg.replace(/^40[13]\s*/, "")); setStatus("offline"); return; }
      misses.current += 1;
      setStatus((prev) => (prev === "online" && misses.current < 3 ? prev : "offline"));
    }
  }, []);

  useEffect(() => {
    check();
    const id = window.setInterval(check, 5000);
    return () => window.clearInterval(id);
  }, [check]);

  // 简单 semver 比较（够用：三段数字）；解析不了一律当"无更新"，绝不误报
  const semverGt = (a: string, b: string) => {
    const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
    if (pa.some(isNaN) || pb.some(isNaN)) return false;
    for (let i = 0; i < 3; i++) { if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0); }
    return false;
  };
  const updateAvailable = !!(latest && version && semverGt(latest, version));
  return { status, version, stale, latest, updateAvailable, blocked, recheck: check };
}
