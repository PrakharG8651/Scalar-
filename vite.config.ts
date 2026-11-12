import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createLiveFeed } from './server/liveFeed.mjs';

function liveFeedPlugin(): Plugin {
  const feed = createLiveFeed();
  return {
    name: 'scalar-live-feed',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = (request as unknown as { url?: string }).url;
        if (!requestUrl?.startsWith('/api/')) { next(); return; }
        void feed.handle(request as unknown as Parameters<typeof feed.handle>[0], response as unknown as Parameters<typeof feed.handle>[1]).then((handled) => { if (!handled) next(); }).catch(() => {
          if (!response.headersSent) response.writeHead(500);
          response.end();
        });
      });
    },
  };
}

export default defineConfig({ base: './', plugins: [react(), liveFeedPlugin()] });
