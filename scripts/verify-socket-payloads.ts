import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import {
  answerSocketPayloadSchema,
  kickSocketPayloadSchema,
  parseSocketPayload,
  sessionSocketPayloadSchema,
} from "@/lib/realtime/socket-payload";

async function main() {
  for (const payload of [undefined, null, "", 1, [], {}, { sessionId: "" }]) {
    assert.throws(() => parseSocketPayload(sessionSocketPayloadSchema, payload));
  }

  assert.deepEqual(
  parseSocketPayload(sessionSocketPayloadSchema, { sessionId: "session-1", ignored: true }),
  { sessionId: "session-1" },
);
  assert.deepEqual(
  parseSocketPayload(kickSocketPayloadSchema, { sessionId: "session-1", participantId: "participant-1" }),
  { sessionId: "session-1", participantId: "participant-1" },
);
  assert.deepEqual(
  parseSocketPayload(answerSocketPayloadSchema, { sessionId: "session-1", questionId: "question-1" }),
  { sessionId: "session-1", questionId: "question-1", choiceId: null },
);
  assert.throws(() => parseSocketPayload(answerSocketPayloadSchema, {
  sessionId: "session-1",
  questionId: "question-1",
  textResponse: "x".repeat(2_001),
  }));

async function guardedHandler(payload: unknown) {
  try {
    return { ok: true, value: parseSocketPayload(sessionSocketPayloadSchema, payload) } as const;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "invalid" } as const;
  }
}

  assert.equal((await guardedHandler(undefined)).ok, false);
  assert.equal((await guardedHandler(null)).ok, false);

  const source = await readFile(new URL("../lib/realtime/socket-server.ts", import.meta.url), "utf8");
  const sourceFile = ts.createSourceFile("socket-server.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const unsafeEvents: string[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "on"
      && node.expression.expression.getText(sourceFile) === "socket"
    ) {
      const eventName = node.arguments[0]?.getText(sourceFile) ?? "unknown";
      const listener = node.arguments[1];
      if (
        listener
        && (ts.isArrowFunction(listener) || ts.isFunctionExpression(listener))
        && listener.parameters[0]
        && ts.isObjectBindingPattern(listener.parameters[0].name)
      ) unsafeEvents.push(eventName);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.deepEqual(unsafeEvents, [], "Socket.IO 이벤트 payload를 매개변수에서 구조 분해하면 검증 전에 예외가 발생합니다.");

  console.log("socket_payload_checks=passed malformed_payloads=rejected handler_destructuring=absent");
}

void main();
