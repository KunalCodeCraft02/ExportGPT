# AGENTS.md — Repo instructions for AI coding agents

Purpose
-------
Provide concise, actionable instructions so an AI coding agent can be productive quickly in this codebase.

Quick start
-----------
- Install dependencies: `npm install`
- Run development server: `npm run dev` (alias: `npm start` — uses `nodemon src/server.js`)
- Seed admin user: `npm run seed:admin`

Project overview
----------------
- Node.js + Express application using ES modules (`type: module`).
- MongoDB via `mongoose` (connection config in `src/config/db.js`).
- Main entry: `src/server.js`.

Primary folders
---------------
- `src/controllers/` — route handlers (suffix `.controller.js`).
- `src/routes/` — route definitions (suffix `.routes.js`).
- `src/services/` — business logic helpers (suffix `.service.js`).
- `src/models/` — Mongoose models (PascalCase filenames: `User.js`, `Product.js`, ...).
- `src/config/` — `db.js` and other config.
- `src/views/` — EJS templates used by the admin UI.
- `src/utils/` — utilities such as `logger.js`.
- `src/scripts/` — helpful one-off scripts (e.g., `seedAdmin.js`).

Conventions and guidance for agents
----------------------------------
- Preserve existing file structure and naming patterns when adding new code.
- Follow the established suffixes: `.controller.js`, `.service.js`, `.routes.js`.
- Use ES module `import` / `export` syntax (project `type: module`).
- Look for and reuse helpers in `src/services/` and `src/utils/` before creating duplicates.
- No test framework detected — do not add tests without asking the maintainer.

Notes & common pitfalls
----------------------
- There is a suspicious filename in `src/services/` with a stray space: `demandintelligence.service .js`. Be careful when editing or referencing that file (trim spaces in filenames).
- Environment variables are expected (project uses `dotenv`) — ensure `.env` is available locally; do not commit secrets.
- Uses EJS server-rendered admin views; changes to views may require restarting the dev server.

Where to look first
-------------------
- App entry and middleware: `src/server.js`.
- DB connection and config: `src/config/db.js`.
- Example flows: `src/routes/` + matching `src/controllers/` + `src/services/`.

Links
-----
- README: [README.md](README.md)

If you'd like, I can also:
- Create automated lint/test instructions, or
- Add a focused `.github/copilot-instructions.md` that provides code-review and commit guidance.
