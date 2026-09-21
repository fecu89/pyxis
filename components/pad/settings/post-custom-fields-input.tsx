"use client";

import styles from "@/components/pad/settings/settings.module.css";
import type {
  PostFieldConfig,
  PostFieldValue,
  PostFieldValues,
} from "@/components/pad/settings/types";

export function PostCustomFieldsInput({
  config,
  values,
  onChange,
}: {
  config: PostFieldConfig;
  values: PostFieldValues;
  onChange: (values: PostFieldValues) => void;
}) {
  function update(fieldId: string, value: PostFieldValue) {
    onChange({ ...values, [fieldId]: value });
  }

  return (
    <div className={styles.panel}>
      {[...config.customFields]
        .filter((field) => !field.archived)
        .sort((left, right) => left.position - right.position)
        .map((field) => (
          <fieldset className={styles.fieldInput} key={field.id}>
            <legend>{field.label}{field.required && " *"}</legend>
            {field.kind === "SHORT_TEXT" && <input value={typeof values[field.id] === "string" ? values[field.id] : ""} required={field.required} maxLength={500} onChange={(event) => update(field.id, event.target.value)} />}
            {field.kind === "LONG_TEXT" && <textarea value={typeof values[field.id] === "string" ? values[field.id] : ""} required={field.required} maxLength={5000} rows={4} onChange={(event) => update(field.id, event.target.value)} />}
            {field.kind === "SINGLE_CHOICE" && (
              <span className={styles.choices}>
                {field.options.map((option) => (
                  <label className={styles.choice} key={option}>
                    <input type="radio" name={`custom-${field.id}`} value={option} checked={values[field.id] === option} required={field.required} onChange={() => update(field.id, option)} />
                    {option}
                  </label>
                ))}
              </span>
            )}
            {field.kind === "MULTIPLE_CHOICE" && (
              <span className={styles.choices}>
                {field.options.map((option) => {
                  const selected = Array.isArray(values[field.id]) ? values[field.id] as string[] : [];
                  return (
                    <label className={styles.choice} key={option}>
                      <input type="checkbox" value={option} checked={selected.includes(option)} onChange={(event) => update(field.id, event.target.checked ? [...selected, option] : selected.filter((item) => item !== option))} />
                      {option}
                    </label>
                  );
                })}
              </span>
            )}
          </fieldset>
        ))}
    </div>
  );
}
