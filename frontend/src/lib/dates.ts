export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function yesterday(): string {
  const value = new Date();
  value.setDate(value.getDate() - 1);
  return formatLocalDate(value);
}
