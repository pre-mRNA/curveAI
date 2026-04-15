import { createApp } from "./app.js";
import { OnboardingSessionCoordinator } from "./durable-objects/onboarding-session.js";

const app = createApp();

export { OnboardingSessionCoordinator };
export default {
  fetch: app.fetch,
};
