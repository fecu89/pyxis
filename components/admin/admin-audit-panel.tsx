"use client";

import { useEffect, useRef, useState } from "react";
import { AuditLogList } from "@/components/admin/audit-log-list";
import type { AuditLogRecord } from "@/components/admin/types";

export function AdminAuditPanel({ initialLogs, initialCursor }: { initialLogs: AuditLogRecord[]; initialCursor: string | null }) {
  const [logs, setLogs] = useState(initialLogs);
  const [cursor, setCursor] = useState(initialCursor);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  async function load(reset: boolean) {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPending(true);
    setError("");
    try {
      const query = new URLSearchParams({ limit: "25" });
      if (!reset && cursor) query.set("cursor", cursor);
      const response = await fetch(`/api/admin/audit-logs?${query}`, { cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "감사 로그를 불러오지 못했습니다.");
      setLogs((current) => reset ? result.logs : [...current, ...result.logs]);
      setCursor(result.nextCursor);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "감사 로그를 불러오지 못했습니다.");
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setPending(false);
      }
    }
  }

  return (
    <div>
      {error ? <p className="admin-global-error" role="alert">{error}</p> : null}
      <AuditLogList logs={logs} hasMore={Boolean(cursor)} pending={pending} onLoadMore={() => void load(false)} onRefresh={() => void load(true)} />
    </div>
  );
}
