import { createApp } from "./app";
import { ensureUploadDir, loadEnv } from "./config/env";

const env = loadEnv();
ensureUploadDir(env.uploadDir);

const app = createApp(env);

export function startServer() {
  return app.listen(env.port, env.host, () => {
    // Keep startup logging minimal for a scaffold.
    console.log(`curve-ai api listening on http://${env.host}:${env.port}`);
  });
}

if (require.main === module) {
  startServer();
}
