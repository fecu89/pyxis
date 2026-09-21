export type SystemPostFieldSettings = {
  visible: boolean;
  required: boolean;
  placeholder: string;
};

export type CustomPostFieldKind = "SHORT_TEXT" | "LONG_TEXT" | "SINGLE_CHOICE" | "MULTIPLE_CHOICE";

export type CustomPostFieldDefinition = {
  id: string;
  key: string;
  label: string;
  kind: CustomPostFieldKind;
  required: boolean;
  position: number;
  options: string[];
  version: number;
  archived: boolean;
};

export type PostFieldConfig = {
  version: number;
  title: SystemPostFieldSettings;
  body: SystemPostFieldSettings;
  attachment: SystemPostFieldSettings;
  customFields: CustomPostFieldDefinition[];
};

export type PostFieldValue = string | string[];
export type PostFieldValues = Record<string, PostFieldValue>;

export type StoredPostFieldValue = {
  fieldVersion: number;
  value: PostFieldValue;
};

export type StoredPostFieldValues = {
  configVersion: number;
  fields: Record<string, StoredPostFieldValue>;
};

export type SystemPostFieldInput = {
  title: string;
  body: string;
  attachmentCount: number;
};
