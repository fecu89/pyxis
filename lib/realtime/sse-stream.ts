import "server-only";

// SSE 스트림의 공통 골격입니다. 보드 이벤트와 개인 알림 두 라우트가 같은 규칙을 쓰도록 모았고,
// 직접 ReadableStream을 다룰 때 실제로 문제가 됐던 세 가지를 여기서 한 번에 막습니다.
//
// 1) enqueue 예외 전파: publishBoardEvent는 EventEmitter의 동기 emit이라, 끊어진 연결의
//    컨트롤러에 enqueue하면 TypeError가 발행자(=쓰기 API Route Handler)까지 그대로 올라가
//    DB 저장이 끝난 요청이 400으로 실패했습니다. heartbeat의 setInterval 콜백에서 같은 일이
//    나면 잡아줄 곳이 없어 uncaughtException이 됩니다. 모든 enqueue를 여기서 감쌉니다.
// 2) 연결 수 무제한: LINK/PUBLIC 보드의 SSE는 비로그인도 붙을 수 있는데 상한이 없어, 연결마다
//    남는 리스너 + 20초 타이머 + 스트림이 그대로 메모리·타이머 고갈로 이어졌습니다.
// 3) 백프레셔 무시: 응답을 읽지 않는 클라이언트에 대해 heartbeat·이벤트가 스트림 내부 큐에
//    무한정 쌓였습니다. desiredSize로 감지해 연결을 끊습니다.

const HEARTBEAT_INTERVAL_MS = 20_000;
// 기본 큐잉 전략(highWaterMark 1)에서 desiredSize는 큐에 쌓인 청크 수만큼 음수로 내려갑니다.
// 정상 클라이언트는 0 근처를 유지하므로, 이만큼 밀렸다면 소비가 멈춘 연결로 보고 끊습니다.
const MAX_QUEUED_CHUNKS = 64;
// 프로세스 전체 SSE 연결 상한(단일 인스턴스 전제, structure.md §8). 상한에 닿으면 새 연결만
// 거절하고 기존 연결은 유지합니다.
const MAX_TOTAL_CONNECTIONS = Number(process.env.MAX_SSE_CONNECTIONS ?? "2000");

const encoder = new TextEncoder();

type ConnectionRegistry = { total: number; perKey: Map<string, number> };

const globalForConnections = globalThis as unknown as { pyxCourseSseConnections?: ConnectionRegistry };

function registry(): ConnectionRegistry {
  if (!globalForConnections.pyxCourseSseConnections) {
    globalForConnections.pyxCourseSseConnections = { total: 0, perKey: new Map() };
  }
  return globalForConnections.pyxCourseSseConnections;
}

function acquireSlot(key: string, maxPerKey: number) {
  const state = registry();
  if (state.total >= MAX_TOTAL_CONNECTIONS) return null;
  const current = state.perKey.get(key) ?? 0;
  if (current >= maxPerKey) return null;
  state.perKey.set(key, current + 1);
  state.total += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (state.perKey.get(key) ?? 1) - 1;
    if (next <= 0) state.perKey.delete(key);
    else state.perKey.set(key, next);
    state.total = Math.max(0, state.total - 1);
  };
}

export type EventEmitFn = (name: string, data: unknown) => boolean;

const tooManyConnections = Response.json(
  { error: "실시간 연결이 너무 많습니다. 열려 있는 다른 탭을 닫고 다시 시도해 주세요." },
  { status: 429, headers: { "Cache-Control": "private, no-store", "Retry-After": "30" } },
);

/**
 * SSE 응답을 만듭니다. `subscribe`는 이벤트를 보낼 `emit`을 받아 구독을 등록하고, 연결이 끝날 때
 * 호출될 정리 함수를 돌려줍니다. 상한을 넘으면 429 응답을 그대로 반환합니다.
 */
export function createEventStream(options: {
  request: Request;
  /** 동시 연결 상한을 세는 버킷 키. 보통 `board:{id}|{식별자}`처럼 대상과 요청자를 함께 씁니다. */
  connectionKey: string;
  maxPerKey: number;
  /** 접근권한 변경처럼 현재 인증으로 스트림을 계속 유지하면 안 될 때 close를 호출합니다. */
  subscribe: (emit: EventEmitFn, close: () => void) => (() => void) | void;
}): Response {
  const releaseSlot = acquireSlot(options.connectionKey, options.maxPerKey);
  if (!releaseSlot) return tooManyConnections;

  let cleanup: (() => void) | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // enqueue는 스트림이 이미 닫히거나 오류 상태면 예외를 던집니다. 여기서 삼키고 연결을
      // 정리해, 이 콜백을 부른 쪽(쓰기 API의 publishBoardEvent, heartbeat 타이머)으로 예외가
      // 새어 나가지 않게 합니다.
      const write = (chunk: Uint8Array) => {
        if (closed) return false;
        try {
          controller.enqueue(chunk);
        } catch {
          cleanup?.();
          return false;
        }
        // 클라이언트가 읽지 않아 큐가 계속 쌓이면 메모리가 무한정 늘어나므로 연결을 끊습니다.
        // 브라우저 EventSource는 자동으로 재연결하고, usePadEvents가 재연결 시 놓친 변경을
        // 패드 전용 JSON 스냅샷으로 보충하므로 데이터 유실로 이어지지 않습니다.
        if ((controller.desiredSize ?? 0) < -MAX_QUEUED_CHUNKS) {
          cleanup?.();
          return false;
        }
        return true;
      };

      const emit: EventEmitFn = (name, data) => {
        return write(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // subscribe가 "ready" 이벤트를 동기적으로 보낼 수 있으므로 cleanup을 먼저 정의해 둡니다
      // (그 시점에 write가 실패하면 cleanup이 아직 undefined라 슬롯이 새어 나갔습니다).
      let unsubscribe: (() => void) | void;
      const heartbeat = setInterval(() => {
        write(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
      }, HEARTBEAT_INTERVAL_MS);

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        try { unsubscribe?.(); } catch { /* 구독 해제 실패가 나머지 정리를 막지 않게 합니다. */ }
        releaseSlot();
        try { controller.close(); } catch { /* 이미 닫혔거나 오류 상태면 무시합니다. */ }
      };

      try {
        unsubscribe = options.subscribe(emit, () => cleanup?.());
      } catch (error) {
        cleanup();
        throw error;
      }

      if (options.request.signal.aborted) {
        cleanup();
        return;
      }
      options.request.signal.addEventListener("abort", () => cleanup?.(), { once: true });
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
