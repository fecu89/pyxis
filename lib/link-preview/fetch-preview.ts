import "server-only";

import http from "node:http";
import https from "node:https";
import { parseLinkPreview } from "@/lib/link-preview/parser";
import {
  LinkPreviewError,
  normalizePreviewUrl,
  resolvePublicAddress,
} from "@/lib/link-preview/security";
import type { LinkPreview } from "@/lib/link-preview/types";
import { fetchYouTubePreview } from "@/lib/link-preview/youtube";

export const maximumHtmlBytes = 3 * 1024 * 1024;
// setTimeout은 "소켓이 놀고 있는 시간"만 재기 때문에, 타임아웃 직전마다 1바이트씩 흘려보내는
// 서버는 이 값과 무관하게 연결을 사실상 무한정 붙잡을 수 있습니다. 리다이렉트 체인까지 합쳐
// 전체 소요 시간에 별도의 마감을 둡니다.
const requestTimeoutMs = 5_000;
const totalDeadlineMs = 12_000;
const maximumRedirects = 3;
const closingHeadTag = Buffer.from("</head>");

type PageResponse = {
  body: Buffer;
  contentType: string;
  location: string | null;
  status: number;
};

// 미리보기 메타데이터는 <head> 안에 있으므로 본문 전체를 받을 이유가 없습니다. 종료 태그가
// 청크 경계에 걸쳐도 찾을 수 있게 짧은 꼬리를 유지하고, 찾는 즉시 스트림 소비를 멈춥니다.
export async function readHtmlHead(
  source: AsyncIterable<Buffer | string>,
  maximumBytes = maximumHtmlBytes,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  let trailing: Buffer = Buffer.alloc(0);

  for await (const chunk of source) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const chunkStart = size;
    size += buffer.length;
    chunks.push(buffer);

    const searchWindow = trailing.length ? Buffer.concat([trailing, buffer]) : buffer;
    const markerIndex = searchWindow.toString("latin1").toLowerCase().indexOf(closingHeadTag.toString());
    if (markerIndex >= 0) {
      const markerEnd = chunkStart - trailing.length + markerIndex + closingHeadTag.length;
      if (markerEnd > maximumBytes) throw new LinkPreviewError("미리보기 응답이 너무 큽니다.", 413);
      return Buffer.concat(chunks, size).subarray(0, markerEnd);
    }
    if (size > maximumBytes) throw new LinkPreviewError("미리보기 응답이 너무 큽니다.", 413);

    const tailLength = Math.min(closingHeadTag.length - 1, searchWindow.length);
    trailing = searchWindow.subarray(searchWindow.length - tailLength);
  }
  return Buffer.concat(chunks, size);
}

async function requestPage(url: URL, deadlineAt: number): Promise<PageResponse> {
  const address = await resolvePublicAddress(url);
  const hostname = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      action();
    };
    const succeed = (value: PageResponse) => settle(() => resolve(value));
    const fail = (error: unknown) => settle(() => reject(error));

    // 유휴 소켓 타임아웃(setTimeout)과 별개로, 응답을 조금씩 흘려보내며 연결을 붙잡는 서버를
    // 위해 전체 마감 시각을 강제합니다.
    const deadlineTimer = setTimeout(() => {
      request.destroy(new LinkPreviewError("외부 페이지 응답 시간이 초과됐습니다.", 504));
    }, Math.max(1, deadlineAt - Date.now()));
    deadlineTimer.unref?.();

    const request = transport.request({
      protocol: url.protocol,
      hostname: address.address,
      family: address.family,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9",
        "Accept-Encoding": "identity",
        Host: url.host,
        "User-Agent": "PyxCourse-LinkPreview/1.0",
      },
      servername: url.protocol === "https:" ? hostname : undefined,
    }, async (response) => {
      const status = response.statusCode ?? 502;
      const location = typeof response.headers.location === "string" ? response.headers.location : null;
      const contentType = typeof response.headers["content-type"] === "string"
        ? response.headers["content-type"].toLowerCase()
        : "";
      if (status >= 300 && status < 400) {
        response.resume();
        succeed({ body: Buffer.alloc(0), contentType, location, status });
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        fail(new LinkPreviewError(`외부 페이지가 HTTP ${status}로 응답했습니다.`, 422));
        return;
      }
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
        response.resume();
        fail(new LinkPreviewError("HTML 페이지 주소만 미리 볼 수 있습니다.", 415));
        return;
      }
      try {
        const body = await readHtmlHead(response);
        // Async iterator가 조기 반환하면 보통 스트림을 정리하지만, Node 버전 차이와 무관하게
        // </head> 뒤의 큰 본문을 더 받지 않도록 소켓도 명시적으로 닫습니다.
        if (!response.complete) response.destroy();
        succeed({ body, contentType, location, status });
      } catch (error) {
        fail(error);
      }
    });

    request.setTimeout(requestTimeoutMs, () => {
      request.destroy(new LinkPreviewError("외부 페이지 응답 시간이 초과됐습니다.", 504));
    });
    request.on("error", (error) => {
      fail(error instanceof LinkPreviewError
        ? error
        : new LinkPreviewError("외부 페이지에 연결하지 못했습니다.", 422));
    });
    request.end();
  });
}

async function validateMetadataUrl(value: string | null, fallback: string) {
  if (!value) return null;
  try {
    const url = normalizePreviewUrl(value);
    await resolvePublicAddress(url);
    return url.toString();
  } catch {
    return fallback === value ? fallback : null;
  }
}

export async function fetchLinkPreview(value: string): Promise<LinkPreview> {
  let url = normalizePreviewUrl(value);
  // 리다이렉트 체인 전체가 이 시각을 넘기지 못하게 합니다.
  const deadlineAt = Date.now() + totalDeadlineMs;
  const youtube = await fetchYouTubePreview(url).catch(() => null);
  if (youtube) {
    const image = await validateMetadataUrl(youtube.image, "");
    return { ...youtube, image };
  }

  for (let redirect = 0; redirect <= maximumRedirects; redirect += 1) {
    if (Date.now() >= deadlineAt) throw new LinkPreviewError("외부 페이지 응답 시간이 초과됐습니다.", 504);
    const response = await requestPage(url, deadlineAt);
    if (response.status >= 300 && response.status < 400) {
      if (!response.location) throw new LinkPreviewError("이동할 주소가 없는 리다이렉트입니다.", 422);
      if (redirect === maximumRedirects) throw new LinkPreviewError("리다이렉트가 너무 많습니다.", 422);
      url = normalizePreviewUrl(response.location, url);
      continue;
    }

    const parsed = parseLinkPreview(response.body.toString("utf8"), url);
    const [canonicalUrl, image] = await Promise.all([
      validateMetadataUrl(parsed.url, url.toString()),
      validateMetadataUrl(parsed.image, ""),
    ]);
    return {
      ...parsed,
      url: canonicalUrl ?? url.toString(),
      image,
    };
  }
  throw new LinkPreviewError("미리보기를 생성하지 못했습니다.", 422);
}
