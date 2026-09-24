export class UserError extends Error {}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function logError(scope: string, error: unknown): void {
  console.error(`[${new Date().toISOString()}] ${scope}: ${errorText(error)}`);
}
