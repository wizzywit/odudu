import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { travelKeyframes } from '../src/features/landing/services/geometry.ts';

// The sign-in scene's travelling signals, written once as CSS so neither the
// page markup nor the script carries them: `node scripts/landing-keyframes.ts`.
const target = path.join(import.meta.dirname, '../src/features/landing/ui/Scene/travel.css');
writeFileSync(target, `${travelKeyframes()}\n`);
