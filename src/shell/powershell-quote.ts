/** Quote a value as a PowerShell single-quoted (literal) string. */
export function psSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
