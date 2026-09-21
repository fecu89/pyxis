import ExcelJS from "exceljs";
import type { FormExportData } from "@/lib/forms/summary";
import { APP_NAME } from "@/lib/brand";

// `lib/exports/xlsx.ts`(패드 내보내기)와 같은 exceljs 관례를 따르되, 여기 것과 별도 파일로 둔
// 이유는 그쪽 overview.md가 명시한 대로 그 폴더가 패드(보드) 전용이기 때문입니다. 워크북을
// 순수하게 만드는 함수만 두고 Prisma 조회는 lib/forms/summary.ts의 gatherFormExportData가
// 맡습니다 — 데이터 만들기와 파일로 굽기를 나누면 테스트가 DB 없이도 워크북 모양을 검증할 수
// 있습니다.

export async function buildFormWorkbook(data: FormExportData): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = APP_NAME;
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("응답");
  sheet.columns = [
    { header: "응답자", key: "respondent", width: 16 },
    { header: "제출일시", key: "submittedAt", width: 20 },
    ...data.fieldTitles.map((title, index) => ({ header: title, key: `field_${index}`, width: 24 })),
  ];
  for (const row of data.rows) {
    const record: Record<string, string> = { respondent: row.respondentLabel, submittedAt: row.submittedAt ?? "" };
    row.values.forEach((value, index) => { record[`field_${index}`] = value; });
    sheet.addRow(record);
  }

  return workbook.xlsx.writeBuffer();
}
