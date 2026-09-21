type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
};

// Milkdown은 `문자**@로 시작하는 값**`도 편집 중 strong 노드로 만들지만, CommonMark는
// 여는 별표 앞뒤가 모두 문장부호가 아닌 경우에만 이를 강조로 다시 해석합니다. 저장된
// Markdown을 ReactMarkdown이 읽을 때만 남는 literal ** 쌍을 strong 노드로 보정해 두
// 화면의 결과를 맞춥니다. 이미 정상 파싱된 strong·code 노드는 text가 아니므로 건드리지 않습니다.
const relaxedStrongPattern = /(?<!\\)\*\*(?=\S)([^*\r\n]*?\S)\*\*/g;

function relaxedStrongChildren(value: string) {
  const children: MarkdownNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(relaxedStrongPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) children.push({ type: "text", value: value.slice(cursor, index) });
    children.push({ type: "strong", children: [{ type: "text", value: match[1] }] });
    cursor = index + match[0].length;
  }
  if (!children.length) return null;
  if (cursor < value.length) children.push({ type: "text", value: value.slice(cursor) });
  return children;
}

function transform(node: MarkdownNode) {
  if (!node.children) return;
  const next: MarkdownNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && child.value?.includes("**")) {
      next.push(...(relaxedStrongChildren(child.value) ?? [child]));
      continue;
    }
    transform(child);
    next.push(child);
  }
  node.children = next;
}

export function remarkRelaxedStrong() {
  return transform;
}
