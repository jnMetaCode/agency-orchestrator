import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/studio";

export type BackendStatus = "checking" | "online" | "offline";

export function useBackend() {
  const [status, setStatus] = useState<BackendStatus>("checking");
  const [version, setVersion] = useState<string | null>(null);
  // 引擎进程启动后代码被重新构建（server.js/dist 更新）→ 内存里跑的是旧代码，
  // 会出现"前端认识、引擎 unknown provider"之类的版本漂移——提示用户重启引擎
  const [stale, setStale] = useState(false);
  const [latest, setLatest] = useState<string | null>(null);

  const check = useCallback(async () => {
    try {
      const h = await api.health();
      setVersion(h.version ?? null);
      setStale(h.stale === true);
      setLatest(h.latest ?? null);
      setStatus("online");
    } catch {
      setStatus("offline");
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
  return { status, version, stale, latest, updateAvailable, recheck: check };
}
