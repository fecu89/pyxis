"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowRightIcon, SessionIcon } from "@/components/ui/icons";
import { LiveGameSurface } from "@/components/quiz/live-game-ui";

export default function JoinPage() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  function updatePin(value: string) {
    const nextPin = value.replace(/\D/g, "").slice(0, 6);
    setPin(nextPin);
    setError(null);
    if (nextPin.length === 6) router.prefetch(`/j/${nextPin}`);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pin.length !== 6) {
      setError("선생님에게 받은 6자리 PIN을 입력해 주세요.");
      return;
    }
    setError(null);
    router.push(`/j/${pin}`);
  }

  return (
    <LiveGameSurface contentClassName="px-4 py-6 sm:px-6 sm:py-8 lg:px-9">
      <div className="flex flex-1 items-center justify-center py-4 sm:py-8">
        <section className="animate-game-pop w-full max-w-2xl text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-[22px] border border-info-200/30 bg-info-300 text-brand-950 shadow-[0_16px_38px_rgba(112,232,238,.2)] sm:h-[72px] sm:w-[72px]">
            <SessionIcon className="h-8 w-8 sm:h-9 sm:w-9" />
          </div>
          <p className="mt-6 text-xs font-black uppercase tracking-[0.28em] text-info-200">Join the game</p>
          <h1 className="mt-3 text-4xl font-black tracking-[-0.055em] text-white sm:text-5xl">퀴즈 PIN을 입력하세요</h1>
          <p id="pin-help" className="mx-auto mt-4 max-w-md text-sm font-semibold leading-6 text-brand-100/65 sm:text-base">
            선생님 화면에 표시된 6자리 숫자를 입력하면 바로 참여할 수 있어요.
          </p>

          <form onSubmit={handleSubmit} className="mx-auto mt-8 max-w-lg rounded-[30px] border border-white/12 bg-white/[0.08] p-4 shadow-[0_28px_80px_rgba(0,0,0,.24)] backdrop-blur-xl sm:p-6" noValidate>
            <div className="flex items-center justify-between px-1 pb-3">
              <label htmlFor="quiz-pin" className="text-xs font-black uppercase tracking-[0.22em] text-brand-100/60">Game PIN</label>
              <span className="font-mono text-xs font-black text-info-200" aria-live="polite">{pin.length} / 6</span>
            </div>
            <input
              id="quiz-pin"
              autoFocus
              value={pin}
              onChange={(event) => updatePin(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              placeholder="000000"
              aria-describedby={error ? "pin-help pin-error" : "pin-help"}
              aria-invalid={Boolean(error)}
              className="h-20 w-full rounded-[22px] border-2 border-white/15 bg-brand-950/55 px-3 text-center font-mono text-4xl font-black tracking-[0.24em] text-white outline-none transition placeholder:text-white/15 focus:border-info-300 focus:bg-brand-950/75 sm:h-24 sm:text-5xl sm:tracking-[0.3em]"
            />

            <div className="mt-3 flex justify-center gap-2" aria-hidden="true">
              {Array.from({ length: 6 }, (_, index) => (
                <span key={index} className={`h-1.5 rounded-full transition-all duration-300 ${index < pin.length ? "w-7 bg-info-300" : "w-3 bg-white/15"}`} />
              ))}
            </div>

            {error ? <p id="pin-error" role="alert" className="mt-4 rounded-2xl border border-danger-300/20 bg-danger-400/15 px-4 py-3 text-sm font-bold text-danger-100">{error}</p> : null}

            <button type="submit" disabled={pin.length !== 6} className="mt-5 flex min-h-16 w-full items-center justify-center gap-2 rounded-[20px] bg-info-300 px-6 text-base font-black text-brand-950 shadow-[0_14px_34px_rgba(112,232,238,.18)] transition hover:-translate-y-0.5 hover:bg-info-200 active:translate-y-0 disabled:translate-y-0 disabled:shadow-none disabled:opacity-35">
              PIN으로 참여하기 <ArrowRightIcon className="h-5 w-5" />
            </button>
          </form>

          <p className="mt-6 text-xs font-bold text-brand-100/45">로그인이 필요한 퀴즈는 로그인 후 이 게임으로 돌아옵니다.</p>
        </section>
      </div>
    </LiveGameSurface>
  );
}
