export class ShortLinkResolveBusyError extends Error {
  constructor() {
    super("짧은 주소 요청이 몰리고 있습니다. 잠시 후 다시 시도해 주세요.");
    this.name = "ShortLinkResolveBusyError";
  }
}
