type ProcessingGate = {
  active: number;
  waiting: Array<() => void>;
};

const globalForProcessing = globalThis as unknown as { pyxCourseImageGate?: ProcessingGate };
const gate = globalForProcessing.pyxCourseImageGate ?? { active: 0, waiting: [] };
globalForProcessing.pyxCourseImageGate = gate;

export class ImageProcessingBusyError extends Error {
  readonly status = 503;

  constructor() {
    super("이미지 처리 요청이 몰려 있습니다. 잠시 후 다시 시도해 주세요.");
    this.name = "ImageProcessingBusyError";
  }
}

function concurrency() {
  const configured = Number(process.env.IMAGE_PROCESSING_CONCURRENCY ?? "2");
  return Number.isFinite(configured) ? Math.min(4, Math.max(1, Math.floor(configured))) : 2;
}

// 대기열에 상한이 없으면 업로드가 몰릴 때 대기 중인 요청마다 임시 파일이 디스크에 남고 resolve
// 클로저가 메모리에 쌓입니다. 동시 실행 2개 기준으로 이 정도면 이미 수 분치 백로그이므로,
// 그 이상은 기다리게 두지 않고 즉시 503으로 돌려보내 클라이언트가 재시도하게 합니다.
function maxWaiting() {
  const configured = Number(process.env.IMAGE_PROCESSING_MAX_QUEUE ?? "32");
  return Number.isFinite(configured) ? Math.min(256, Math.max(1, Math.floor(configured))) : 32;
}

async function acquire() {
  if (gate.active < concurrency()) {
    gate.active += 1;
    return;
  }
  if (gate.waiting.length >= maxWaiting()) throw new ImageProcessingBusyError();
  await new Promise<void>((resolve) => gate.waiting.push(resolve));
}

function release() {
  const next = gate.waiting.shift();
  if (next) next();
  else gate.active = Math.max(0, gate.active - 1);
}

export async function withImageProcessingSlot<T>(task: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await task();
  } finally {
    release();
  }
}
