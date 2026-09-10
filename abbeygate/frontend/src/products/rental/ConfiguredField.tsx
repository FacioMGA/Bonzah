import { useId } from 'react';
import { Button, Input, Select } from '@/src/shared/ui';
import { readAnswer, writeAnswer, type FacioField } from './facioApi';

type Props = {
  field: FacioField;
  answers: Record<string, unknown>;
  disabled?: boolean;
  onChange: (path: string[], value: unknown) => void;
};
const supportedTypes = new Set([
  'text',
  'email',
  'tel',
  'number',
  'currency',
  'money',
  'integer',
  'date',
  'datetime',
  'boolean',
  'select',
  'hidden',
  'paragraph',
  'textarea',
  'multiselect',
]);
export function unsupportedField(field: FacioField): boolean {
  if (!field.sourceCollection) return !supportedTypes.has(field.type);
  const collection = field.sourceCollection;
  return (
    !Number.isInteger(collection.minimumItems) ||
    !Number.isInteger(collection.maximumItems) ||
    collection.minimumItems < 0 ||
    collection.maximumItems < collection.minimumItems ||
    !Array.isArray(collection.fields) ||
    collection.fields.some(unsupportedField)
  );
}
export function collectionErrors(fields: FacioField[], answers: Record<string, unknown>): string[] {
  return fields.flatMap((field) => {
    const collection = field.sourceCollection;
    if (!collection) return [];
    const value = readAnswer(answers, field.answerPath);
    if (value !== undefined && !Array.isArray(value))
      return [`${field.label}: invalid collection.`];
    const rows = Array.isArray(value) ? value : [];
    if (rows.length < collection.minimumItems || rows.length > collection.maximumItems)
      return [
        `${field.label}: enter between ${collection.minimumItems} and ${collection.maximumItems} ${collection.itemLabel.toLowerCase()} entries.`,
      ];
    return rows.flatMap((row, index) =>
      collection.fields.flatMap((child) => {
        const answer = readAnswer(row, child.answerPath);
        return (child.required || child.requiredAtStages?.includes('quote')) &&
          (answer === undefined || answer === '' || answer === null)
          ? [`${collection.itemLabel} ${index + 1}: ${child.label} is required.`]
          : [];
      }),
    );
  });
}
/** Renderer consumes exact published paths; collection children are relative to their own row. */
export function ConfiguredField({ field, answers, disabled, onChange }: Props) {
  const id = useId();
  const value = readAnswer(answers, field.answerPath);
  const blocked = Boolean(disabled || field.readOnly);
  const required = Boolean(
    field.required || field.requiredAtStages?.some((stage) => ['quote', 'pricing'].includes(stage)),
  );
  const change = (next: unknown) => onChange(field.answerPath, next);
  const collection = field.sourceCollection;
  if (field.type === 'hidden') return null;
  if (collection) {
    const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
    return (
      <fieldset className="min-w-0 space-y-4 rounded-xl border border-slate-200 p-4 sm:col-span-2">
        <legend className="px-1 font-semibold">{field.label}</legend>
        <p className="text-sm text-slate-600">
          {collection.minimumItems === 0 ? 'Optional. ' : ''}
          {rows.length} of {collection.maximumItems} {collection.itemLabel.toLowerCase()} entries.
        </p>
        {rows.map((row, index) => (
          <fieldset key={index} className="min-w-0 space-y-3 rounded-lg bg-slate-50 p-4">
            <legend className="font-semibold">
              {collection.itemLabel} {index + 1}
            </legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {collection.fields.map((child) => (
                <ConfiguredField
                  key={child.key}
                  field={child}
                  answers={row}
                  disabled={blocked}
                  onChange={(path, answer) =>
                    change(
                      rows.map((entry, i) =>
                        i === index ? writeAnswer(entry, path, answer) : entry,
                      ),
                    )
                  }
                />
              ))}
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={blocked || rows.length <= collection.minimumItems}
              onClick={() => change(rows.filter((_, i) => i !== index))}
            >
              Remove {collection.itemLabel.toLowerCase()} {index + 1}
            </Button>
          </fieldset>
        ))}
        <Button
          type="button"
          variant="secondary"
          disabled={blocked || rows.length >= collection.maximumItems}
          onClick={() => change([...rows, {}])}
        >
          Add {collection.itemLabel.toLowerCase()}
        </Button>
        {field.help && <p className="text-xs text-slate-500">{field.help}</p>}
      </fieldset>
    );
  }
  if (field.type === 'paragraph')
    return <p className="whitespace-pre-wrap text-sm sm:col-span-2">{field.body || field.label}</p>;
  const common = {
    id,
    'aria-label': field.label,
    name: field.key,
    disabled: blocked,
    required,
    'aria-required': required,
  };
  const options = field.options?.map((option) =>
    typeof option === 'string' ? { value: option, label: option } : option,
  );
  const numeric = ['number', 'currency', 'money', 'integer'].includes(field.type);
  const control =
    field.type === 'boolean' ? (
      <Select
        {...common}
        value={value === true ? 'true' : value === false ? 'false' : ''}
        onChange={(event) =>
          change(event.target.value === '' ? undefined : event.target.value === 'true')
        }
      >
        <option value="">Select</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </Select>
    ) : field.type === 'multiselect' ? (
      <Select
        {...common}
        multiple
        value={Array.isArray(value) ? value.map(String) : []}
        onChange={(event) =>
          change(Array.from(event.target.selectedOptions, (option) => option.value))
        }
      >
        {options?.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    ) : options?.length ? (
      <Select
        {...common}
        value={String(value ?? '')}
        onChange={(event) => change(event.target.value)}
      >
        <option value="">Select</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    ) : (
      <Input
        {...common}
        type={
          numeric
            ? 'number'
            : field.type === 'date'
              ? 'date'
              : field.type === 'email'
                ? 'email'
                : 'text'
        }
        step={numeric ? 'any' : undefined}
        value={String(value ?? '')}
        placeholder={field.exactTime ? 'YYYY-MM-DDTHH:mm:ss-06:00' : undefined}
        onChange={(event) =>
          change(
            numeric && event.target.value !== '' ? Number(event.target.value) : event.target.value,
          )
        }
      />
    );
  return (
    <div className="min-w-0 space-y-2 text-sm font-semibold">
      <label htmlFor={id}>
        {field.label}
        {required ? ' *' : ''}
      </label>
      {control}
      {field.exactTime && (
        <p className="text-xs font-normal text-slate-500">
          Exact local time including UTC offset. Date changes retain this selected time and offset.
        </p>
      )}
      {field.help && <p className="text-xs font-normal text-slate-500">{field.help}</p>}
    </div>
  );
}
