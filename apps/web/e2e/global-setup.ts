import { execSync } from 'node:child_process';

// Build once, sequentially, before the parallel webServer processes spawn —
// the game server and the vite-served client both need core/server dist output.
export default function globalSetup(): void {
  execSync(
    'npm run build --workspace @boulder-maze/core --silent && npm run build --workspace @boulder-maze/server --silent',
    { stdio: 'inherit' },
  );
}
