import type { ConfigField } from '../../shared/contracts'
import { Checkbox, Field, Input, Select } from './ui'

interface Props {
  schema: ConfigField[]
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
}

export default function ConfigForm({ schema, values, onChange }: Props): JSX.Element {
  return (
    <>
      {schema.map((field) => {
        if (field.type === 'boolean') {
          return (
            <Field key={field.key}>
              <Checkbox
                label={field.label}
                checked={Boolean(values[field.key] ?? field.default ?? false)}
                onChange={(e) => onChange(field.key, e.target.checked)}
              />
            </Field>
          )
        }

        return (
          <Field key={field.key} label={field.label}>
            {field.type === 'select' ? (
              <Select
                value={String(values[field.key] ?? field.default ?? '')}
                onChange={(e) => onChange(field.key, e.target.value)}
              >
                {(field.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </Select>
            ) : field.type === 'secret' ? (
              <Input
                type="password"
                value={String(values[field.key] ?? '')}
                onChange={(e) => onChange(field.key, e.target.value)}
                placeholder={field.required ? 'Required' : 'Optional'}
              />
            ) : field.type === 'number' ? (
              <Input
                type="number"
                value={Number(values[field.key] ?? field.default ?? 0)}
                onChange={(e) => onChange(field.key, Number(e.target.value))}
              />
            ) : (
              <Input
                type="text"
                value={String(values[field.key] ?? field.default ?? '')}
                onChange={(e) => onChange(field.key, e.target.value)}
              />
            )}
          </Field>
        )
      })}
    </>
  )
}
