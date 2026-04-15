import { createApp } from "./app.js";
import type { EdgeApiEnv } from "./env.js";
import { OnboardingSessionCoordinator } from "./durable-objects/onboarding-session.js";

export { OnboardingSessionCoordinator };
export default {
  fetch(request: Request, env: EdgeApiEnv, executionCtx: ExecutionContext) {
    const app = createApp({ env });
    return app.fetch(request, env, executionCtx);
  },
};
