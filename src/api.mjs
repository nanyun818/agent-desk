let token = '';
export async function api(url, options = {}) {
  const response = await fetch('/api' + url, { ...options, headers: { 'Content-Type': 'application/json', 'x-agent-token': token, ...options.headers }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  if (!response.ok) { let error; try { error = (await response.json()).error; } catch {} throw new Error(error || `请求失败 (${response.status})`); }
  if (options.raw) return response;
  const result = await response.json();
  if (url === '/bootstrap') token = result.token;
  return result;
}
