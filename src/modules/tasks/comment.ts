// PostgreSQL char_length counts Unicode code points, including emoji as one.
export const commentLimit = 4_000;
export const commentHint = 'До 4 000 символов.';
export const commentError = 'Сократите комментарий до 4 000 символов.';

export function fitsComment(value: string) {
  if (value.length <= commentLimit) return true;
  if (value.length > commentLimit * 2) return false;
  return Array.from(value).length <= commentLimit;
}
