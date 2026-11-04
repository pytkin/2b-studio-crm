export function assertPublicApiUrl(value: string) {
  // Check the original authority and delimiters. URL normalizes empty userinfo, query and fragment.
  if (/^https?:\/\/[^/@]+(?:\/|$)/i.test(value) && !/[?#\\\s]/.test(value) && URL.canParse(value)) {
    const { protocol, hostname } = new URL(value);
    if (
      protocol === 'https:' ||
      hostname === 'localhost' ||
      hostname === '[::1]' ||
      /^127\.\d+\.\d+\.\d+$/.test(hostname)
    )
      return;
  }
  throw new Error('Проверьте публичный URL API Supabase.');
}
