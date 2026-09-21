const MAX_ROUTE_DECODE_PASSES = 2;

// Next의 동적 params/useParams 값은 현재 앱에서 percent-encoded 문자열로 들어옵니다. DB에서
// 받은 순수 slug와 라우터에서 받은 인코딩 slug를 모두 받을 수 있게 최대 두 번만 풀어, 한때
// 생성됐던 %25EC... 형태의 이중 인코딩 링크도 복구합니다. slug 생성기는 %를 허용하지 않습니다.
export function decodeBoardRouteSlug(value: string): string {
  let decoded = value;
  for (let pass = 0; pass < MAX_ROUTE_DECODE_PASSES; pass += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

export function boardRoutePath(slug: string): string {
  return `/b/${encodeURIComponent(decodeBoardRouteSlug(slug))}`;
}

export function boardPostRoutePath(slug: string, postId: string): string {
  return `${boardRoutePath(slug)}/posts/${encodeURIComponent(postId)}`;
}
