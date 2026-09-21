import "server-only";

import { ZipArchive, type ArchiverError } from "archiver";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { parseSignatureStrokes, strokesToSvgPath, type SignatureStrokes } from "@/lib/forms/signature";
import { responseExportName } from "@/lib/forms/export-names";
import { respondentLabel } from "@/lib/forms/summary";
import { resolveStoredFile } from "@/lib/files/paths";
import { getPrisma } from "@/lib/prisma";

const SVG_WIDTH = 1200;
const SVG_HEIGHT = 400;
const PATH_SEPARATORS = /[\\/]+/g;
const CONTROL_CHARS = /[\x00-\x1f]/g;

type ExportFile = { id: string; originalName: string; storagePath: string };
type ExportAnswer = {
  fieldId: string;
  fieldTitle: string;
  signature: SignatureStrokes | null;
  files: ExportFile[];
};

export type FormResponseFilesExportData = {
  formTitle: string;
  artifactCount: number;
  responses: Array<{
    responseId: string;
    respondentLabel: string;
    answers: ExportAnswer[];
  }>;
};

function sanitizeZipSegment(value: string, fallback: string) {
  const cleaned = value.normalize("NFC").replace(PATH_SEPARATORS, "_").replace(CONTROL_CHARS, "").trim();
  return cleaned.slice(0, 80) || fallback;
}

/** 서명 좌표를 그대로 벡터 이미지로 직렬화합니다. 래스터 변환보다 작고 확대해도 깨지지 않습니다. */
export function renderSignatureSvg(strokes: SignatureStrokes) {
  const path = strokesToSvgPath(strokes, SVG_WIDTH, SVG_HEIGHT);
  const dots = strokes
    .filter((stroke) => stroke.length === 1)
    .map(([point]) => `<circle cx="${point.x * SVG_WIDTH}" cy="${point.y * SVG_HEIGHT}" r="4" fill="#111827"/>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}">`
    + `<rect width="100%" height="100%" fill="#ffffff"/>`
    + `<path d="${path}" fill="none" stroke="#111827" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`
    + dots
    + "</svg>";
}

/** 제출 응답에 귀속된 파일과 실제 획이 있는 서명을 함께 조회합니다. */
export async function gatherFormResponseFiles(formId: string): Promise<FormResponseFilesExportData> {
  const prisma = getPrisma();
  const [form, responses] = await Promise.all([
    prisma.form.findUniqueOrThrow({ where: { id: formId }, select: { title: true } }),
    prisma.formResponse.findMany({
      where: { formId },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        respondentName: true,
        respondent: { select: { id: true, nameEncrypted: true, imageEncrypted: true } },
        answers: {
          where: { fieldType: { in: ["SIGNATURE", "FILE_UPLOAD"] } },
          orderBy: { answeredAt: "asc" },
          select: {
            fieldId: true,
            fieldTitle: true,
            fieldType: true,
            signatureStrokes: true,
            files: {
              where: { deletedAt: null },
              select: { id: true, originalName: true, storagePath: true },
            },
          },
        },
      },
    }),
  ]);

  let artifactCount = 0;
  const result = responses.flatMap((response, index) => {
    const answers = response.answers.flatMap((answer): ExportAnswer[] => {
      const signature = answer.fieldType === "SIGNATURE" ? parseSignatureStrokes(answer.signatureStrokes) : [];
      if (!signature.length && !answer.files.length) return [];
      artifactCount += signature.length ? 1 : 0;
      artifactCount += answer.files.length;
      return [{
        fieldId: answer.fieldId,
        fieldTitle: answer.fieldTitle,
        signature: signature.length ? signature : null,
        files: answer.files,
      }];
    });
    return answers.length ? [{
      responseId: response.id,
      respondentLabel: responseExportName(respondentLabel(index + 1, response), response.id),
      answers,
    }] : [];
  });

  return { formTitle: form.title, artifactCount, responses: result };
}

/** 첨부 원본은 파일 스트림으로, 서명은 작은 SVG 문자열로 ZIP에 순차적으로 붙입니다. */
export function buildFormResponseFilesZipStream(data: FormResponseFilesExportData) {
  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on("warning", (error: ArchiverError) => console.error("form-response-files-zip warning", error));

  void (async () => {
    try {
      for (const response of data.responses) {
        const responseFolder = sanitizeZipSegment(response.respondentLabel, `익명 응답_${response.responseId.slice(-6)}`);
        for (const answer of response.answers) {
          const field = sanitizeZipSegment(answer.fieldTitle, "제목 없는 질문");
          if (answer.signature) {
            archive.append(renderSignatureSvg(answer.signature), {
              name: `${responseFolder}/${field}_서명_${answer.fieldId.slice(-6)}.svg`,
            });
          }
          for (const file of answer.files) {
            const absolutePath = resolveStoredFile(file.storagePath);
            const fileInfo = await stat(absolutePath).catch(() => null);
            if (!fileInfo?.isFile()) continue;
            const originalName = sanitizeZipSegment(file.originalName, file.id);
            archive.append(createReadStream(absolutePath), {
              name: `${responseFolder}/${field}/${file.id.slice(-6)}_${originalName}`,
            });
          }
        }
      }
    } finally {
      void archive.finalize();
    }
  })();

  return archive;
}
