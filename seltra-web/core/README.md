# Seltra

Seltra is an AI-powered app builder for creating and iterating on web applications. This repository contains the Seltra Builder desktop application and its browser-based development runtime.

Seltra Builder helps you turn a description into a working app, inspect and edit its code, and preview changes as you build. It supports configurable AI providers and models; available capabilities depend on the provider and the runtime you use.

## Run Seltra Builder

### Desktop development

Requirements: Node.js and npm. Install dependencies and start the Electron application:

```sh
npm install
npm start
```

On first launch, Seltra creates its local application data. To enable Git hooks for development, run:

```sh
npm run init-precommit
```

### Browser-based web runtime

The runtime service runs locally as the AI/build engine for the Seltra merchant frontend. It requires Node.js 24, a running Nest API, and `.env.web`. It does not provide a separate login or UI.

```sh
npm run web:dev
```

Set `CORE_TOKEN_SECRET` and `CORE_SERVICE_SECRET` in both `backend/.env` and `core/.env.web` to the same independently generated secrets. Set `NEST_INTERNAL_URL=http://localhost:3001`, and add the frontend origin to `GATEWAY_ALLOWED_ORIGINS` (normally `http://localhost:3000`). Configure model provider values in `.env.web` as needed. Run the merchant frontend at `http://localhost:3000`; it connects to this gateway with a short-lived tenant token minted by Nest. Keep secrets and API keys in local environment files; never commit them.

Additional web runtime commands:

```sh
npm run web:build
npm run web:test
npm run web:e2e
```

See the [web runtime runbook](./docs/web-port/RUNBOOK.md) for detailed configuration and verification steps.

## Development

Useful checks include:

```sh
npm run ts
npm test
npm run lint
npm run fmt:check
```

For contribution guidance and end-to-end testing instructions, read [CONTRIBUTING.md](./CONTRIBUTING.md). The architecture guides are in [`docs/`](./docs/).

## License

Files outside `src/pro` are licensed under Apache License 2.0; see [LICENSE](./LICENSE). Files in `src/pro` are licensed under the Fair Source License defined in [`src/pro/LICENSE`](./src/pro/LICENSE).
