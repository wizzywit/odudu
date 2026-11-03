import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { travelKeyframes } from '../src/features/landing/services/sceneMotion.ts';

// Runs under plain Node: the services it imports reach each other as
// `@site/src/features/landing/services/...`, which Node resolves through the
// self-reference in that folder's package.json, so it imports nothing outside it.
// The sign-in scene's travelling signals, written once as CSS so neither the
// page markup nor the script carries them: `node scripts/landing-keyframes.ts`.
const target = path.join(import.meta.dirname, '../src/features/landing/ui/Scene/travel.css');
writeFileSync(target, `${travelKeyframes()}\n`);
