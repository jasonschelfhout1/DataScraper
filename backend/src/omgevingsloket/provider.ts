import { DiscoveryRequiredError } from './errors.js';
import type { Document, DownloadStream, OmgevingsloketProvider, Project, ProjectSearchPage, SearchBounds } from './types.js';

/**
 * Deliberately blocks normal retrieval until scripts/discover.ts records the
 * actual public API. Replacing this class is the only integration-layer edit.
 */
export class DiscoveryRequiredProvider implements OmgevingsloketProvider {
  async searchProjects(_bounds: SearchBounds, _page: number): Promise<ProjectSearchPage> { throw new DiscoveryRequiredError(); }
  async getProject(_projectNumber: string): Promise<Project> { throw new DiscoveryRequiredError(); }
  async getDocuments(_projectNumber: string): Promise<Document[]> { throw new DiscoveryRequiredError(); }
  async downloadDocument(_projectNumber: string, _documentId: string): Promise<DownloadStream> { throw new DiscoveryRequiredError(); }
}
