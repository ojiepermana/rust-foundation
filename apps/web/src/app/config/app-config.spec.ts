import { EnvironmentProviders, Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { appConfig } from '../app.config';
import { APP_CONFIG, AppConfig, loadAppConfig, startApp, validateAppConfig } from './app-config';

const FAILURE_MESSAGE =
  'Application configuration could not be loaded. Check /config.json and reload the page.';

// Shared URL vectors of spec 0002, also used by the Rust tests in apps/api/src/config.rs.
const VALID_BASE_URLS = [
  '/api',
  '/api/v1',
  'https://api.example.com',
  'https://api.example.com:8443/base',
  'http://localhost:3000',
];
const INVALID_BASE_URLS = [
  '',
  '/',
  '/api/',
  '//evil.example',
  '/\\evil.example',
  'api',
  'https://user:pass@api.example.com',
  'https://',
  'HTTP://api.example.com',
  'https://api.example.com/?x=1',
  'https://api.example.com#f',
  'ftp://example.com',
  ' /api',
  '/a pi',
];

type Providers = (Provider | EnvironmentProviders)[];

function respondWith(body: string, status = 200) {
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(body, { status, headers: { 'Content-Type': 'application/json' } }),
    ),
  );
}

function setup(fetchFn: typeof fetch) {
  const root = document.createElement('app-root');
  const bootstrap = vi.fn<(providers: Providers) => Promise<unknown>>(() => Promise.resolve());
  const logError = vi.fn<(error: unknown) => void>();
  const run = () => startApp({ root, fetchFn, bootstrap, logError });
  return { root, bootstrap, logError, run };
}

/** Builds an injector from the providers handed to bootstrap and reads APP_CONFIG. */
function injectedConfig(providers: Providers): AppConfig {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers });
  return TestBed.inject(APP_CONFIG);
}

describe('validateAppConfig', () => {
  // covers: 0002 AC-6
  it.each(VALID_BASE_URLS)('accepts apiBaseUrl %j', (apiBaseUrl) => {
    expect(validateAppConfig({ apiBaseUrl })).toEqual({ apiBaseUrl });
  });

  // covers: 0002 AC-6
  it.each(INVALID_BASE_URLS)('rejects apiBaseUrl %j', (apiBaseUrl) => {
    expect(() => validateAppConfig({ apiBaseUrl })).toThrow(Error);
  });

  // Parity with the Rust rule (char::is_whitespace or char::is_control), added
  // by the author on top of the spec vectors. The same code points are listed
  // in apps/api/src/config.rs, so the two languages cannot drift apart.
  const SPACE_OR_CONTROL = [
    0x00, 0x09, 0x0a, 0x0d, 0x1f, 0x20, 0x7f, 0x85, 0x9f, 0xa0, 0x1680, 0x2000, 0x200a, 0x2028,
    0x2029, 0x202f, 0x205f, 0x3000,
  ];
  const NEITHER_SPACE_NOR_CONTROL = [0xa1, 0x180e, 0x200b, 0x200c, 0xfeff];
  const withCodePoint = (codePoint: number) => `/api${String.fromCodePoint(codePoint)}v1`;

  // covers: 0002 AC-6
  it.each(SPACE_OR_CONTROL)('rejects code point %i inside apiBaseUrl', (codePoint) => {
    expect(() => validateAppConfig({ apiBaseUrl: withCodePoint(codePoint) })).toThrow(Error);
  });

  // covers: 0002 AC-6
  it.each(NEITHER_SPACE_NOR_CONTROL)('accepts code point %i inside apiBaseUrl', (codePoint) => {
    const apiBaseUrl = withCodePoint(codePoint);
    expect(validateAppConfig({ apiBaseUrl })).toEqual({ apiBaseUrl });
  });

  // covers: 0002 AC-6
  it.each([null, undefined, [], ['/api'], '/api', 42, true])(
    'rejects %j as not a JSON object',
    (raw) => {
      expect(() => validateAppConfig(raw)).toThrow(Error);
    },
  );

  // covers: 0002 AC-6
  it('rejects keys other than apiBaseUrl, including __proto__', () => {
    expect(() => validateAppConfig({ apiBaseUrl: '/api', databaseUrl: 'x' })).toThrow(
      /databaseUrl/,
    );
    expect(() =>
      validateAppConfig(JSON.parse('{"apiBaseUrl":"/api","__proto__":{"x":1}}')),
    ).toThrow(Error);
  });

  // covers: 0002 AC-6
  it('rejects a missing or non string apiBaseUrl', () => {
    expect(() => validateAppConfig({})).toThrow(Error);
    expect(() => validateAppConfig({ apiBaseUrl: 42 })).toThrow(Error);
    expect(() => validateAppConfig({ apiBaseUrl: null })).toThrow(Error);
  });
});

describe('loadAppConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // covers: 0002 AC-6
  it('fetches /config.json once, without cache, with a 5 second timeout signal', async () => {
    const createTimeout = AbortSignal.timeout.bind(AbortSignal);
    const signals: AbortSignal[] = [];
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      const signal = createTimeout(milliseconds);
      signals.push(signal);
      return signal;
    });
    const fetchFn = respondWith('{ "apiBaseUrl": "/api" }');

    await expect(loadAppConfig(fetchFn)).resolves.toEqual({ apiBaseUrl: '/api' });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('/config.json');
    expect(init?.cache).toBe('no-store');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(timeout).toHaveBeenCalledWith(5000);
    expect(signals).toHaveLength(1);
    expect(init?.signal).toBe(signals[0]);
  });

  // covers: 0002 AC-6
  it.each([302, 404, 500, 503])('rejects HTTP status %i', async (status) => {
    await expect(loadAppConfig(respondWith('{ "apiBaseUrl": "/api" }', status))).rejects.toThrow(
      String(status),
    );
  });

  // covers: 0002 AC-6
  it.each([
    '{ "apiBaseUrl": ',
    '<!doctype html><html><body><app-root></app-root></body></html>',
    '',
  ])('rejects a body that is not JSON: %j', async (body) => {
    await expect(loadAppConfig(respondWith(body))).rejects.toThrow();
  });

  // covers: 0002 AC-6
  it('rejects when the request itself fails or times out', async () => {
    const fetchFn = vi.fn<typeof fetch>(() =>
      Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
    );
    await expect(loadAppConfig(fetchFn)).rejects.toThrow('timed out');
  });
});

describe('startApp', () => {
  // covers: 0002 AC-6
  it('bootstraps with APP_CONFIG added to the application providers', async () => {
    const { root, bootstrap, logError, run } = setup(respondWith('{ "apiBaseUrl": "/api" }'));

    await run();

    expect(bootstrap).toHaveBeenCalledTimes(1);
    const providers = bootstrap.mock.calls[0]?.[0] ?? [];
    expect(providers.slice(0, appConfig.providers.length)).toEqual(appConfig.providers);
    expect(providers.at(-1)).toEqual({ provide: APP_CONFIG, useValue: { apiBaseUrl: '/api' } });
    expect(injectedConfig(providers)).toEqual({ apiBaseUrl: '/api' });
    expect(root.hasAttribute('role')).toBe(false);
    expect(root.textContent).toBe('');
    expect(logError).not.toHaveBeenCalled();
  });

  // covers: 0002 AC-6
  it('gives two different config.json contents two different APP_CONFIG values', async () => {
    const first = setup(respondWith('{ "apiBaseUrl": "/api" }'));
    const second = setup(respondWith('{ "apiBaseUrl": "https://api.example.com:8443/base" }'));

    await first.run();
    await second.run();

    expect(injectedConfig(first.bootstrap.mock.calls[0]?.[0] ?? [])).toEqual({
      apiBaseUrl: '/api',
    });
    expect(injectedConfig(second.bootstrap.mock.calls[0]?.[0] ?? [])).toEqual({
      apiBaseUrl: 'https://api.example.com:8443/base',
    });
  });

  // covers: 0002 AC-6
  it.each([
    ['an HTTP error', respondWith('not found', 404)],
    ['broken JSON', respondWith('{ "apiBaseUrl"')],
    ['an index.html fallback', respondWith('<!doctype html><html></html>')],
    ['a foreign key', respondWith('{ "apiBaseUrl": "/api", "secret": "x" }')],
    ['an invalid URL', respondWith('{ "apiBaseUrl": "//evil.example" }')],
    [
      'a network failure',
      vi.fn<typeof fetch>(() => Promise.reject(new TypeError('Failed to fetch'))),
    ],
  ])('does not bootstrap and shows the alert on %s', async (_case, fetchFn) => {
    const { root, bootstrap, logError, run } = setup(fetchFn);

    await run();

    expect(bootstrap).not.toHaveBeenCalled();
    expect(root.textContent).toBe(FAILURE_MESSAGE);
    expect(root.getAttribute('role')).toBe('alert');
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  // covers: 0002 AC-6
  it('still logs the failure when the page has no app-root', async () => {
    const bootstrap = vi.fn<(providers: Providers) => Promise<unknown>>(() => Promise.resolve());
    const logError = vi.fn<(error: unknown) => void>();

    await startApp({ root: null, fetchFn: respondWith('[]'), bootstrap, logError });

    expect(bootstrap).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('logs a bootstrap failure without showing the configuration alert', async () => {
    const { root, bootstrap, logError, run } = setup(respondWith('{ "apiBaseUrl": "/api" }'));
    const failure = new Error('bootstrap failed');
    bootstrap.mockRejectedValueOnce(failure);

    await run();

    expect(logError).toHaveBeenCalledWith(failure);
    expect(root.hasAttribute('role')).toBe(false);
  });
});
