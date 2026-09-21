import "server-only";

import ExcelJS from "exceljs";

export const STUDENT_ROSTER_MAX_BYTES = 3 * 1024 * 1024;
export const STUDENT_ROSTER_MAX_ROWS = 500;

const REQUIRED_HEADERS = ["학교", "학년", "반", "번호", "이름"] as const;

export type StudentRosterRow = {
  line: number;
  schoolName: string;
  grade: number;
  classNumber: number;
  studentNumber: number;
  name: string;
  studentCode: string;
  loginId: string;
  initialPassword: string;
};

export class StudentRosterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudentRosterError";
  }
}

function normalizedText(value: string) {
  return value.trim().replace(/\s+/gu, " ");
}

function cellText(cell: ExcelJS.Cell, line: number, header: string) {
  const value = cell.value;
  if (value && typeof value === "object" && "formula" in value) {
    throw new StudentRosterError(`${line}행 ${header} 셀에는 수식을 사용할 수 없습니다.`);
  }
  return normalizedText(cell.text);
}

function integerCell(text: string, line: number, header: string, min: number, max: number) {
  if (!/^\d+$/u.test(text)) throw new StudentRosterError(`${line}행 ${header}은(는) 숫자로 입력해 주세요.`);
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new StudentRosterError(`${line}행 ${header}은(는) ${min}~${max} 범위로 입력해 주세요.`);
  }
  return value;
}

export function normalizeStudentIdPrefix(value: string) {
  const prefix = value.trim().toLocaleLowerCase("en-US");
  if (!/^[a-z0-9]{1,10}$/u.test(prefix)) {
    throw new StudentRosterError("아이디 접두어는 1~10자 영문자·숫자로 입력해 주세요.");
  }
  return prefix;
}

export async function parseStudentRoster(file: File, prefixValue: string): Promise<StudentRosterRow[]> {
  if (!file.name.toLocaleLowerCase("en-US").endsWith(".xlsx")) {
    throw new StudentRosterError("Excel 통합 문서(.xlsx)만 업로드할 수 있습니다.");
  }
  if (file.size <= 0 || file.size > STUDENT_ROSTER_MAX_BYTES) {
    throw new StudentRosterError("명단 파일은 3MB 이하의 .xlsx 파일이어야 합니다.");
  }
  const prefix = normalizeStudentIdPrefix(prefixValue);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(await file.arrayBuffer()) as unknown as ExcelJS.Buffer);
  } catch {
    throw new StudentRosterError("Excel 파일을 읽지 못했습니다. 손상되지 않은 .xlsx 파일인지 확인해 주세요.");
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new StudentRosterError("첫 번째 시트에 학생 명단을 넣어 주세요.");
  if (worksheet.rowCount > STUDENT_ROSTER_MAX_ROWS + 20) {
    throw new StudentRosterError(`한 번에 최대 ${STUDENT_ROSTER_MAX_ROWS}명까지 등록할 수 있습니다.`);
  }

  let headerLine = 0;
  for (let line = 1; line <= Math.min(10, worksheet.rowCount); line += 1) {
    const values = worksheet.getRow(line).values;
    if (Array.isArray(values) && values.some((value) => normalizedText(String(value ?? "")))) {
      headerLine = line;
      break;
    }
  }
  if (!headerLine) throw new StudentRosterError("학교, 학년, 반, 번호, 이름 머리글을 찾지 못했습니다.");

  const headerIndexes = new Map<string, number>();
  worksheet.getRow(headerLine).eachCell((cell, column) => {
    const header = normalizedText(cell.text).replace(/\s/gu, "");
    if (header) headerIndexes.set(header, column);
  });
  for (const header of REQUIRED_HEADERS) {
    if (!headerIndexes.has(header)) throw new StudentRosterError(`필수 열 ‘${header}’이(가) 없습니다.`);
  }

  const rows: StudentRosterRow[] = [];
  const seenLoginIds = new Map<string, number>();
  for (let line = headerLine + 1; line <= worksheet.rowCount; line += 1) {
    const row = worksheet.getRow(line);
    const rawValues = REQUIRED_HEADERS.map((header) => cellText(row.getCell(headerIndexes.get(header)!), line, header));
    if (rawValues.every((value) => !value)) continue;
    if (rawValues.some((value) => !value)) throw new StudentRosterError(`${line}행의 학교·학년·반·번호·이름을 모두 입력해 주세요.`);

    const [schoolText, gradeText, classText, numberText, nameText] = rawValues;
    const schoolName = normalizedText(schoolText);
    const name = normalizedText(nameText);
    if (schoolName.length > 100 || /[\u0000-\u001f\u007f]/u.test(schoolName)) {
      throw new StudentRosterError(`${line}행 학교 이름은 제어 문자 없이 100자 이하로 입력해 주세요.`);
    }
    if (name.length > 40 || /[\u0000-\u001f\u007f]/u.test(name)) {
      throw new StudentRosterError(`${line}행 학생 이름은 제어 문자 없이 40자 이하로 입력해 주세요.`);
    }
    const grade = integerCell(gradeText, line, "학년", 1, 12);
    const classNumber = integerCell(classText, line, "반", 1, 99);
    const studentNumber = integerCell(numberText, line, "번호", 1, 99);
    const studentCode = `${grade}${String(classNumber).padStart(2, "0")}${String(studentNumber).padStart(2, "0")}`;
    const loginId = `${prefix}${studentCode}`;
    const duplicateLine = seenLoginIds.get(loginId);
    if (duplicateLine) throw new StudentRosterError(`${line}행과 ${duplicateLine}행에서 같은 아이디 ${loginId}가 생성됩니다.`);
    seenLoginIds.set(loginId, line);
    rows.push({
      line,
      schoolName,
      grade,
      classNumber,
      studentNumber,
      name,
      studentCode,
      loginId,
      // 초기 비밀번호는 아이디와 동일하게 둡니다. 예전의 "이름 첫 글자 + 학생 코드"는 한글
      // 이름이면 비밀번호에 한글이 섞여 로그인 화면에서 입력 자체가 안 되는 사고가 났습니다.
      // 어차피 mustChangePassword로 첫 로그인 직후 변경이 강제되므로 임시값은 단순한 쪽이 안전합니다.
      initialPassword: loginId,
    });
    if (rows.length > STUDENT_ROSTER_MAX_ROWS) {
      throw new StudentRosterError(`한 번에 최대 ${STUDENT_ROSTER_MAX_ROWS}명까지 등록할 수 있습니다.`);
    }
  }
  if (!rows.length) throw new StudentRosterError("등록할 학생 행이 없습니다.");
  return rows;
}

// 양식은 특정 서비스 이름 없이 범용으로 만듭니다(파일명도 forms.xlsx) — 학교에서 같은 파일을
// 다른 시스템 제출용으로 재활용하는 일이 흔해서, 브랜딩이 박혀 있으면 그때마다 다시 만들게 됩니다.
export async function buildStudentRosterTemplate(): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("학생 명단", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "학교", key: "school", width: 24 },
    { header: "학년", key: "grade", width: 10 },
    { header: "반", key: "classNumber", width: 10 },
    { header: "번호", key: "studentNumber", width: 10 },
    { header: "이름", key: "name", width: 16 },
  ];
  sheet.addRow({ school: "한국고등학교", grade: 3, classNumber: 1, studentNumber: 6, name: "홍길동" });
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF377557" } };
  sheet.autoFilter = { from: "A1", to: "E1" };
  for (let row = 2; row <= STUDENT_ROSTER_MAX_ROWS + 1; row += 1) {
    sheet.getCell(`B${row}`).dataValidation = { type: "whole", operator: "between", formulae: [1, 12], allowBlank: true };
    sheet.getCell(`C${row}`).dataValidation = { type: "whole", operator: "between", formulae: [1, 99], allowBlank: true };
    sheet.getCell(`D${row}`).dataValidation = { type: "whole", operator: "between", formulae: [1, 99], allowBlank: true };
  }
  const guide = workbook.addWorksheet("작성 안내");
  guide.getColumn(1).width = 90;
  [
    "첫 번째 시트의 학교·학년·반·번호·이름 다섯 열을 유지해 주세요.",
    "아이디는 관리자 화면에서 입력한 접두어 + 학년 1자리 + 반 2자리 + 번호 2자리 형식입니다.",
    "예: 접두어 ch, 3학년 1반 6번 → ch30106",
    "초기 비밀번호는 아이디와 같습니다. 첫 로그인 직후 새 비밀번호로 바꿔야 합니다.",
  ].forEach((text) => guide.addRow([text]));
  return workbook.xlsx.writeBuffer();
}
