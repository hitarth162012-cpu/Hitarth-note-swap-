const DEVICE_KEY = 'ns_device_id';

function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = `dev_${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'dev_browser';
  }
}

export async function apiRequest<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('X-Requested-With', 'NoteSwap');
  headers.set('X-Device-Id', getDeviceId());

  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (!isFormData && options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    ...options,
    credentials: 'include',
    headers,
  });

  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }

  if (!res.ok) {
    const errMsg =
      typeof (data as { error?: string })?.error === 'string'
        ? (data as { error: string }).error
        : `Request failed (${res.status})`;
    throw new Error(errMsg);
  }

  return data as T;
}
