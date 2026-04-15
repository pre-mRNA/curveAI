import type { EdgeApiEnv } from "../env.js";

export class OnboardingSessionCoordinator {
  constructor(
    private readonly state: DurableObjectState,
    private readonly _env: EdgeApiEnv,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname.endsWith("/touch")) {
      const payload = (await request.json().catch(() => ({}))) as { type?: string; status?: string };
      const eventCount = ((await this.state.storage.get<number>("eventCount")) ?? 0) + 1;
      const now = new Date().toISOString();
      await this.state.storage.put({
        eventCount,
        lastEventAt: now,
        lastEventType: payload.type ?? "unknown",
        lastStatus: payload.status ?? "unknown",
      });
      return Response.json({
        ok: true,
        eventCount,
        lastEventAt: now,
      });
    }

    if (request.method === "GET" && url.pathname.endsWith("/status")) {
      const [eventCount, lastEventAt, lastEventType, lastStatus] = await Promise.all([
        this.state.storage.get<number>("eventCount"),
        this.state.storage.get<string>("lastEventAt"),
        this.state.storage.get<string>("lastEventType"),
        this.state.storage.get<string>("lastStatus"),
      ]);
      return Response.json({
        ok: true,
        eventCount: eventCount ?? 0,
        lastEventAt: lastEventAt ?? null,
        lastEventType: lastEventType ?? null,
        lastStatus: lastStatus ?? null,
      });
    }

    return Response.json(
      {
        ok: false,
        error: {
          message: "Not found",
        },
      },
      { status: 404 },
    );
  }
}
