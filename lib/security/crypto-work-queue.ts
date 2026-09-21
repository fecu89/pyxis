import "server-only";

const MAX_CONCURRENT_CRYPTO_WORK = 4;
const MAX_WAITING_CRYPTO_WORK = 32;

let activeWork = 0;
const waiters: Array<() => void> = [];

export class CryptoWorkBusyError extends Error {
  constructor() {
    super("암호 확인 요청이 몰리고 있습니다. 잠시 후 다시 시도해 주세요.");
    this.name = "CryptoWorkBusyError";
  }
}

async function acquireSlot() {
  if (activeWork < MAX_CONCURRENT_CRYPTO_WORK) {
    activeWork += 1;
  } else {
    if (waiters.length >= MAX_WAITING_CRYPTO_WORK) throw new CryptoWorkBusyError();
    await new Promise<void>((resolve) => waiters.push(resolve));
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = waiters.shift();
    if (next) next();
    else activeWork -= 1;
  };
}

export async function runBoundedCryptoWork<T>(work: () => Promise<T>) {
  const release = await acquireSlot();
  try {
    return await work();
  } finally {
    release();
  }
}
