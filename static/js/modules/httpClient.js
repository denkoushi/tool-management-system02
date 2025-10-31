export async function requestJSON(url, options = {}) {
  const {
    method = 'GET',
    body = undefined,
    headers = {},
    allowedStatus = [],
  } = options;

  const init = {
    method,
    headers: { ...headers },
  };

  if (body !== undefined && body !== null) {
    if (body instanceof FormData) {
      init.body = body;
    } else if (typeof body === 'string') {
      init.body = body;
      if (!init.headers['Content-Type']) {
        init.headers['Content-Type'] = 'application/json';
      }
    } else {
      init.body = JSON.stringify(body);
      if (!init.headers['Content-Type']) {
        init.headers['Content-Type'] = 'application/json';
      }
    }
  }

  const response = await fetch(url, init);
  const contentType = response.headers.get('content-type') || '';
  let data = null;
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }
  } else {
    const text = await response.text();
    data = text ? { message: text } : null;
  }

  const ok = response.ok || allowedStatus.includes(response.status);
  if (!ok) {
    const message = (data && (data.error || data.message)) || response.statusText || 'Request failed';
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return { data, response };
}
