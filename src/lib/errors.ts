export class StaleError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string, id: string) =>
  new StaleError(404, `${what} '${id}' not found`);
export const conflict = (message: string, details?: unknown) =>
  new StaleError(409, message, details);
export const badRequest = (message: string, details?: unknown) =>
  new StaleError(400, message, details);
