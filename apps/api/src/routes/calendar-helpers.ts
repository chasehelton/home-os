// Small shared helpers used by both calendar routes and ai executor.

const CAL_WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

/** True if the stored OAuth `scopes` string grants write access. */
export function hasWriteScope(scopes: string | null | undefined): boolean {
  if (!scopes) return false;
  const tokens = scopes.split(/\s+/);
  return (
    tokens.includes(CAL_WRITE_SCOPE) || tokens.includes('https://www.googleapis.com/auth/calendar')
  );
}
