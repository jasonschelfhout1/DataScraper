import { parseProjectInput } from '../backend/src/validation.js';
import { DiscoveryRequiredProvider } from '../backend/src/omgevingsloket/provider.js';
import { DiscoveryRequiredError } from '../backend/src/omgevingsloket/errors.js';

const input = process.argv[2];
if (!input) throw new Error('Usage: npm run scrape -- <project number or official project URL>');
const projectNumber = parseProjectInput(input);
try {
  const provider = new DiscoveryRequiredProvider();
  const project = await provider.getProject(projectNumber);
  const documents = await provider.getDocuments(projectNumber);
  console.log(`Project: ${project.title ?? project.projectNumber}`);
  console.log(`Found ${documents.length} documents`);
} catch (error) {
  if (error instanceof DiscoveryRequiredError) {
    console.error('No upstream API mapping has been confirmed. Run `npm run discover -- ' + projectNumber + '`, complete the official verification, and document the captured requests before enabling scrape.');
    process.exitCode = 2;
  } else throw error;
}
