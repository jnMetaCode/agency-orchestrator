import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/studio";

export type BackendStatus = "checking" | "online" | "offline";

export function useBackend() {
  const [status, setStatus] = useState<BackendStatus>("checking");
  const [version, setVersion] = useState<string | null>(null);

  const check = useCallback(async () => {
    try {
      const h = await api.health();
      setVersion(h.version ?? null);
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

  return { status, version, recheck: check };
}
