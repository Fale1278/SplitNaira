# SplitNaira Frontend

Next.js app scaffold for the SplitNaira web experience.

## Scripts
- `npm ci`
- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run test`

## Notes
- Dependencies are pinned to exact versions in `package.json` and `package-lock.json`.
- Always install with `npm ci` locally and in CI to guarantee the same dependency graph.
- Propose dependency upgrades in dedicated PRs by running `npm install <name>@<version>` (or `npm install -D <name>@<version>`), committing both manifest and lockfile changes together.
- Configure `NEXT_PUBLIC_*` variables in `.env.local` based on `.env.example`.

## Structure
- `src/app` - App Router pages and layout
- `src/components` - Reusable UI components
- `src/lib` - Stellar/Soroban helpers and client utilities