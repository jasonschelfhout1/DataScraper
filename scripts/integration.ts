import { parseProjectInput } from '../backend/src/validation.js';

const input = process.argv[2];
if (!input) throw new Error('Usage: npm run test:integration -- <project number>');
console.error(`Integration testing for ${parseProjectInput(input)} is disabled until docs/omgevingsloket-api.md records confirmed endpoint mappings.`);
process.exitCode = 2;
