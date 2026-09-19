import { parseProjectInput } from '../backend/src/validation.js';
import { HttpOmgevingsloketProvider } from '../backend/src/omgevingsloket/http-provider.js';

const input = process.argv[2];
if (!input) throw new Error('Usage: npm run scrape -- <project number or official project URL>');
const projectNumber = parseProjectInput(input);
const provider = new HttpOmgevingsloketProvider();
const project = await provider.getProject(projectNumber);
const documents = await provider.getDocuments(projectNumber);
console.log(`Project: ${project.title ?? project.projectNumber}`);
console.log(`Found ${documents.length} documents`);
documents.forEach((document, index) => console.log(`${index + 1}. ${document.name}${document.downloadable ? '' : ' (view only)'}`));
