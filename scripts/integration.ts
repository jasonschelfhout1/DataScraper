import { parseProjectInput } from '../backend/src/validation.js';
import { HttpOmgevingsloketProvider } from '../backend/src/omgevingsloket/http-provider.js';

const input = process.argv[2];
if (!input) throw new Error('Usage: npm run test:integration -- <project number>');
const projectNumber = parseProjectInput(input);
const provider = new HttpOmgevingsloketProvider();
const project = await provider.getProject(projectNumber);
const documents = await provider.getDocuments(projectNumber);
if (project.projectNumber !== projectNumber) throw new Error('The returned project number did not match the requested project.');
if (documents.some((document) => document.projectNumber !== projectNumber)) throw new Error('A document was associated with the wrong project.');
console.log(`Integration succeeded: ${project.title ?? projectNumber}; ${documents.length} documents discovered.`);
