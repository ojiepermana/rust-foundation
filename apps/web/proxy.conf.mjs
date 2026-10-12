// Proxy of the Angular dev server, started by `bun run dev` (spec 0004). The Angular loader only
// reads a default export, so this file is an exception to the named exports rule in AGENTS.md.
const target = process.env.DEV_API_TARGET;

if (!target) {
  throw new Error('DEV_API_TARGET is not set; start the dev server with bun run dev');
}

export default {
  '^/api(/|$)': { target, secure: false, changeOrigin: false },
};
