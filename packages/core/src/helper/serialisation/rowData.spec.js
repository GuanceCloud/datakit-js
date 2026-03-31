import {
  escapeFieldValueStr,
  escapeJsonValue,
  escapeRowData,
  escapeRowField
} from './rowData'

describe('rowData serialisation helpers', () => {
  it('should escape row data strings and objects', () => {
    expect(escapeRowData('hello world=test,"quoted"')).toBe(
      'hello\\ world\\=test\\,\\"quoted\\"'
    )
    expect(escapeRowData({ value: 1 })).toBe('{\\\"value\\\":1}')
    expect(escapeRowData(42)).toBe(42)
  })

  it('should stringify tag values and preserve non-tag primitives', () => {
    expect(escapeJsonValue({ nested: true })).toBe('{"nested":true}')
    expect(escapeJsonValue(12, true)).toBe('12')
    expect(escapeJsonValue(false, false)).toBe(false)
  })

  it('should quote and escape field values', () => {
    expect(escapeFieldValueStr('say "hello" \\ world')).toBe(
      '"say \\"hello\\" \\\\ world"'
    )
    expect(escapeRowField('value')).toBe('"value"')
    expect(escapeRowField({ nested: true })).toBe('"{\\"nested\\":true}"')
    expect(escapeRowField(10)).toBe(10)
  })
})
