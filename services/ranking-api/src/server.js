import { InMemoryRankingRepository } from './repository.js';
import { RankingService } from './service.js';
import { createHttpServer } from './http.js';
import { openApiDocument } from './openapi.js';

const port = Number(process.env.PORT || 8087);

// Safe default for standalone development. Production integration replaces this
// repository with a read-only WS07 adapter as documented in INTEGRATION_PATCH.md.
const repository = new InMemoryRankingRepository({
  characters: [],
  clans: [],
  updatedAt: new Date(0).toISOString()
});
const service = new RankingService({ repository });
const server = createHttpServer({ service, openApiDocument });

server.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'ranking_api_listening', port, readOnly: true }));
});
