"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Check, LoaderCircle, Palette, RotateCcw } from "lucide-react";
import {
  BRAND_CHROMA_MAX,
  BRAND_CHROMA_MIN,
  BRAND_PRESETS,
  DEFAULT_BRAND_THEME,
  matchBrandPreset,
  normalizeBrandTheme,
  type BrandTheme,
} from "@/lib/theme";

async function responseJson(response: Response) {
  const result = await response.json().catch(() => ({ error: "서버 응답을 확인하지 못했습니다." }));
  if (!response.ok) throw new Error(result.error || "요청을 처리하지 못했습니다.");
  return result;
}

/**
 * 미리보기와 저장이 **같은 두 변수**만 다룹니다. 미리보기는 이 변수를 얹은 컨테이너 안에서
 * 실제 토큰(--brand-soft, --line, --surface …)을 쓰는 조각들을 그리므로, 여기서 보이는 색이
 * 곧 저장 후 화면 색입니다. 색을 따로 계산해 칠하면 미리보기와 실물이 갈라집니다.
 */
// 이 스타일을 받는 element에는 반드시 `theme-scope` 클래스가 함께 붙어야 합니다. 커스텀
// 속성은 선언된 element에서 값이 확정되므로, --brand-h만 얹고 클래스를 빠뜨리면 --brand는
// :root 값 그대로여서 미리보기가 통째로 기본 색으로 보입니다(실제로 그랬습니다).
function previewStyle({ brandHue, brandChroma }: BrandTheme): CSSProperties {
  return { "--brand-h": String(brandHue), "--brand-c": String(brandChroma / 100) } as CSSProperties;
}

function applyRootBrandTheme(theme: BrandTheme) {
  const normalized = normalizeBrandTheme(theme);
  const root = document.documentElement;
  if (normalized.brandHue === DEFAULT_BRAND_THEME.brandHue && normalized.brandChroma === DEFAULT_BRAND_THEME.brandChroma) {
    root.style.removeProperty("--brand-h");
    root.style.removeProperty("--brand-c");
    return;
  }
  root.style.setProperty("--brand-h", String(normalized.brandHue));
  root.style.setProperty("--brand-c", String(normalized.brandChroma / 100));
}

export function ThemePanel({
  initialTheme,
  onAuditChanged,
}: {
  initialTheme: BrandTheme;
  onAuditChanged?: () => void;
}) {
  const [draft, setDraft] = useState<BrandTheme>(() => normalizeBrandTheme(initialTheme));
  const [saved, setSaved] = useState<BrandTheme>(() => normalizeBrandTheme(initialTheme));
  const savedRef = useRef<BrandTheme>(normalizeBrandTheme(initialTheme));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  const dirty = draft.brandHue !== saved.brandHue || draft.brandChroma !== saved.brandChroma;
  const activePreset = useMemo(() => matchBrandPreset(draft), [draft]);
  const isDefault = draft.brandHue === DEFAULT_BRAND_THEME.brandHue && draft.brandChroma === DEFAULT_BRAND_THEME.brandChroma;

  // 저장 전에도 관리 콘솔 전체가 새 색으로 보이게 <html>에 바로 얹습니다. 그래야 사이드바·
  // 표·배지처럼 미리보기 상자에 넣기 어려운 실제 화면으로 확인할 수 있습니다. 저장하지 않고
  // 화면을 떠나면 다음 요청에서 서버가 저장된 값으로 다시 렌더링하므로 남지 않습니다.
  useEffect(() => {
    applyRootBrandTheme(draft);
  }, [draft]);

  useEffect(() => () => {
    // 클라이언트 탭 이동은 루트 layout을 다시 마운트하지 않습니다. 변수를 그냥 지우면 저장된
    // 비기본 테마도 CSS 기본 파랑으로 돌아가므로, 마지막으로 저장된 값을 직접 복원합니다.
    applyRootBrandTheme(savedRef.current);
  }, []);

  async function save() {
    if (!dirty || pending) return;
    setPending(true);
    setMessage("");
    try {
      const result = await responseJson(await fetch("/api/admin/theme", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      }));
      const next = normalizeBrandTheme(result);
      savedRef.current = next;
      setSaved(next);
      setDraft(next);
      setMessage("테마를 저장했습니다. 모든 사용자에게 이 색이 보입니다.");
      onAuditChanged?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="admin-panel theme-panel" role="tabpanel">
      <header className="admin-panel-header">
        <div>
          <span className="admin-kicker">THEME</span>
          <h2>테마</h2>
          <p>
            사이트 전체 브랜드 색을 정합니다. 로그인한 모든 사용자와 공개 참여 화면에 같은 색이 적용됩니다.
            명도는 고정이라 어떤 색을 골라도 본문 대비는 유지되고, 위험·경고·성공 같은 상태색은 뜻이 바뀌지 않도록 따라가지 않습니다.
          </p>
        </div>
      </header>

      <div className="theme-panel-body">
        <div className="theme-presets" role="group" aria-label="테마 프리셋">
          {BRAND_PRESETS.map((preset) => {
            const selected = activePreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                className="theme-preset theme-scope"
                aria-pressed={selected}
                disabled={pending}
                style={previewStyle(preset)}
                onClick={() => setDraft({ brandHue: preset.brandHue, brandChroma: preset.brandChroma })}
              >
                <span className="theme-preset-swatch" aria-hidden>
                  {selected ? <Check size={15} /> : null}
                </span>
                <span className="theme-preset-copy">
                  <b>{preset.label}</b>
                  <small>{preset.hint}</small>
                </span>
              </button>
            );
          })}
        </div>

        <div className="theme-sliders">
          <label>
            <span>
              색상각 <b>{draft.brandHue}°</b>
            </span>
            <input
              type="range"
              min={0}
              max={359}
              step={1}
              value={draft.brandHue}
              disabled={pending}
              onChange={(event) => setDraft((current) => ({ ...current, brandHue: Number(event.target.value) }))}
            />
            <small>빨강 0° · 주황 45° · 초록 150° · 청록 200° · 파랑 250° · 보라 300°</small>
          </label>
          <label>
            <span>
              채도 <b>{draft.brandChroma}%</b>
            </span>
            <input
              type="range"
              min={BRAND_CHROMA_MIN}
              max={BRAND_CHROMA_MAX}
              step={1}
              value={draft.brandChroma}
              disabled={pending}
              onChange={(event) => setDraft((current) => ({ ...current, brandChroma: Number(event.target.value) }))}
            />
            <small>0%는 완전한 무채색, 100%가 기본값입니다.</small>
          </label>
        </div>

        {/* 미리보기 조각은 전부 실제 토큰만 씁니다 — 여기 보이는 색이 곧 저장 후 화면 색입니다. */}
        <div className="theme-preview theme-scope" style={previewStyle(draft)}>
          <div className="theme-preview-row">
            <button type="button" className="button primary" tabIndex={-1}>기본 버튼</button>
            <button type="button" className="button soft" tabIndex={-1}>보조 버튼</button>
            <button type="button" className="button ghost" tabIndex={-1}>외곽선</button>
          </div>
          <div className="theme-preview-row">
            <span className="theme-preview-chip theme-preview-chip-brand">활성 메뉴</span>
            <span className="theme-preview-chip theme-preview-chip-success">성공</span>
            <span className="theme-preview-chip theme-preview-chip-warning">경고</span>
            <span className="theme-preview-chip theme-preview-chip-danger">위험</span>
            <span className="theme-preview-chip theme-preview-chip-info">정보</span>
          </div>
          <div className="theme-preview-scale" aria-label="브랜드 명도 11단계">
            {[50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((step) => (
              <span key={step} style={{ background: `var(--brand-${step})` }} title={`brand-${step}`} />
            ))}
          </div>
          <div className="theme-preview-card">
            <b>패드 카드 미리보기</b>
            <p>본문 글자와 테두리, 배경이 같은 색상각을 따라가는지 확인합니다.</p>
            <span className="theme-preview-deco" aria-label="장식 팔레트">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <i key={n} style={{ background: `var(--deco-${n})` }} />
              ))}
            </span>
          </div>
        </div>

        <div className="theme-panel-actions">
          <button type="button" className="button primary" onClick={() => void save()} disabled={!dirty || pending}>
            {pending ? <LoaderCircle size={14} className="spin" /> : <Palette size={14} />}
            테마 저장
          </button>
          <button
            type="button"
            className="button ghost"
            onClick={() => setDraft(DEFAULT_BRAND_THEME)}
            disabled={pending || isDefault}
          >
            <RotateCcw size={14} />
            기본값으로
          </button>
          {message ? <p className="school-dashboard-message" role="status">{message}</p> : null}
        </div>
      </div>
    </section>
  );
}
