const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function validateServiceName(value) {
  const raw = String(value ?? '');
  const name = raw.trim();
  if (!name) return 'Enter a service name.';
  if (name === '.' || name === '..') return 'Enter a service name other than . or ...';
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(name)) return 'The service name contains a character that is not allowed in a folder name.';
  if (/[. ]$/.test(raw)) return 'The service name cannot end with a period or space.';
  if (WINDOWS_RESERVED_NAME.test(name)) return 'The service name is reserved by Windows.';
  return undefined;
}
