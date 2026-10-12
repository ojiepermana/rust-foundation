import { EnvironmentProviders, InjectionToken, Provider } from '@angular/core';
import { appConfig } from '../app.config';

/**
 * Runtime configuration read from the public `/config.json` before bootstrap
 * (spec 0002). Everything in it is public; new keys only come through a spec
 * and are never secrets.
 */
export interface AppConfig {
  apiBaseUrl: string;
}

export const APP_CONFIG = new InjectionToken<AppConfig>('APP_CONFIG');

const CONFIG_URL = '/config.json';
const CONFIG_TIMEOUT_MS = 5000;
const LOAD_FAILURE_MESSAGE =
  'Application configuration could not be loaded. Check /config.json and reload the page.';

/** Unicode White_Space or a control character (category Cc), as in the Rust rule. */
function isSpaceOrControl(codePoint: number): boolean {
  return (
    codePoint <= 0x20 ||
    (codePoint >= 0x7f && codePoint <= 0xa0) ||
    codePoint === 0x1680 ||
    (codePoint >= 0x2000 && codePoint <= 0x200a) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029 ||
    codePoint === 0x202f ||
    codePoint === 0x205f ||
    codePoint === 0x3000
  );
}

/**
 * The shared URL rule of spec 0002, the same as `is_valid_base_url` in
 * `apps/api/src/config.rs`: a path that starts with exactly one `/`, or an
 * `http://` or `https://` URL with a host and no userinfo, without spaces,
 * control characters, `\`, query, fragment, or trailing slash.
 */
function isValidBaseUrl(value: string): boolean {
  for (const char of value) {
    if (char === '\\' || isSpaceOrControl(char.codePointAt(0) ?? 0)) {
      return false;
    }
  }
  if (value.includes('?') || value.includes('#') || value.endsWith('/')) {
    return false;
  }
  if (value.startsWith('/')) {
    const path = value.slice(1);
    return path.length > 0 && !path.startsWith('/');
  }
  const scheme = ['http://', 'https://'].find((prefix) => value.startsWith(prefix));
  if (scheme === undefined) {
    return false;
  }
  const authority = value.slice(scheme.length).split('/')[0] ?? '';
  const host = authority.split(':')[0] ?? '';
  return !authority.includes('@') && host.length > 0;
}

/** Accepts only a JSON object whose single key `apiBaseUrl` passes the shared URL rule. */
export function validateAppConfig(raw: unknown): AppConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${CONFIG_URL} must contain a JSON object`);
  }
  const unknownKeys = Object.keys(raw).filter((key) => key !== 'apiBaseUrl');
  if (unknownKeys.length > 0) {
    throw new Error(`${CONFIG_URL} has keys other than apiBaseUrl: ${unknownKeys.join(', ')}`);
  }
  const apiBaseUrl = 'apiBaseUrl' in raw ? raw.apiBaseUrl : undefined;
  if (typeof apiBaseUrl !== 'string' || !isValidBaseUrl(apiBaseUrl)) {
    throw new Error(
      `${CONFIG_URL} apiBaseUrl must be a path starting with / or an http:// or https:// URL, without query, fragment, or trailing slash`,
    );
  }
  return { apiBaseUrl };
}

/** Fetches `/config.json` without cache, within 5 seconds, and validates it. */
export async function loadAppConfig(fetchFn: typeof fetch = fetch): Promise<AppConfig> {
  const response = await fetchFn(CONFIG_URL, {
    cache: 'no-store',
    signal: AbortSignal.timeout(CONFIG_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${CONFIG_URL} answered HTTP ${String(response.status)}`);
  }
  const raw: unknown = await response.json();
  return validateAppConfig(raw);
}

interface StartAppDeps {
  /** The `app-root` element, or `null` when the page has none. */
  root: Element | null;
  fetchFn: typeof fetch;
  bootstrap: (providers: (Provider | EnvironmentProviders)[]) => Promise<unknown>;
  logError: (error: unknown) => void;
}

/**
 * Loads the runtime configuration, then bootstraps with `APP_CONFIG` added to
 * the application providers. When the configuration cannot be loaded the app
 * does not bootstrap and `app-root` shows an alert instead.
 */
export async function startApp(deps: StartAppDeps): Promise<void> {
  let config: AppConfig;
  try {
    config = await loadAppConfig(deps.fetchFn);
  } catch (error: unknown) {
    if (deps.root !== null) {
      // The role goes first so the element is already a live region when the text lands.
      deps.root.setAttribute('role', 'alert');
      deps.root.textContent = LOAD_FAILURE_MESSAGE;
    }
    deps.logError(error);
    return;
  }
  try {
    await deps.bootstrap([...appConfig.providers, { provide: APP_CONFIG, useValue: config }]);
  } catch (error: unknown) {
    deps.logError(error);
  }
}
