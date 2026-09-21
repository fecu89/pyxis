import styles from "@/components/pad/settings/settings.module.css";
import type {
  PostFieldConfig,
  PostFieldValues,
} from "@/components/pad/settings/types";

export function PostCustomFieldsDisplay({
  config,
  values,
}: {
  config: PostFieldConfig;
  values: PostFieldValues;
}) {
  const fields = [...config.customFields]
    .filter((field) => Object.hasOwn(values, field.id))
    .sort((left, right) => left.position - right.position);
  if (!fields.length) return null;
  return (
    <dl className={styles.display}>
      {fields.map((field) => {
        const value = values[field.id];
        return (
          <div key={field.id}>
            <dt>{field.label}</dt>
            <dd>{Array.isArray(value) ? value.join(", ") : value}</dd>
          </div>
        );
      })}
    </dl>
  );
}
