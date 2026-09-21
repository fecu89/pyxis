type OptionIdentity = { id?: string; clientId?: string };
type FieldIdentity = { id?: string; clientId: string; options: OptionIdentity[] };

/**
 * 저장 요청 중에 사용자가 계속 편집했을 때 서버가 새로 발급한 영속 ID와 문서 버전만 최신
 * 로컬 문서에 합칩니다. 서버 전문으로 갈아 끼우면 저장 뒤에 입력한 내용이 사라지고, 응답을
 * 버리기만 하면 다음 저장이 낡은 updatedAt 또는 이미 생성된 임시 ID로 충돌합니다.
 */
export function reconcileSavedFormIdentity<
  TOption extends OptionIdentity,
  TField extends FieldIdentity & { options: TOption[] },
  TForm extends { updatedAt: string; fields: TField[] },
>(current: TForm, saved: TForm): TForm {
  const savedFields = new Map<string, TField>();
  for (const field of saved.fields) {
    savedFields.set(field.clientId, field);
    if (field.id) savedFields.set(field.id, field);
  }

  const fields = current.fields.map((field) => {
    const persisted = savedFields.get(field.clientId) ?? (field.id ? savedFields.get(field.id) : undefined);
    if (!persisted) return field;
    const savedOptions = new Map<string, TOption>();
    for (const option of persisted.options) {
      if (option.clientId) savedOptions.set(option.clientId, option);
      if (option.id) savedOptions.set(option.id, option);
    }
    return {
      ...field,
      id: field.id ?? persisted.id,
      options: field.options.map((option) => {
        const savedOption = option.clientId
          ? savedOptions.get(option.clientId)
          : option.id
            ? savedOptions.get(option.id)
            : undefined;
        return savedOption ? { ...option, id: option.id ?? savedOption.id } : option;
      }),
    };
  });

  return {
    ...current,
    updatedAt: saved.updatedAt,
    fields,
  } as TForm;
}
