export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
  body?: unknown
): Promise<T> {
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`/api${path}`, options);

  if (response.status === 204) {
    return undefined as T;
  }

  const data = await response.json().catch(() => ({ error: response.statusText }));

  if (!response.ok) {
    throw new ApiError(response.status, data?.error ?? 'Request failed');
  }

  return data as T;
}
