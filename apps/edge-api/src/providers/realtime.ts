import { createParticipantToken } from "../crypto.js";
import type { ProviderMode, RealtimeVoiceSession } from "../models.js";

export interface RealtimeVoiceProvider {
  readonly mode: ProviderMode;
  issueBrowserSession(input: {
    sessionId: string;
  }): Promise<RealtimeVoiceSession>;
}

export class MockRealtimeVoiceProvider implements RealtimeVoiceProvider {
  readonly mode: ProviderMode = "mock";

  async issueBrowserSession(input: { sessionId: string }): Promise<RealtimeVoiceSession> {
    return {
      provider: "elevenlabs-browser",
      mode: this.mode,
      sessionToken: createParticipantToken(),
      interviewerModel: "realtime-lite",
      supervisorModel: "frontier-reasoning",
      websocketUrl: `wss://mock.voice.local/session/${encodeURIComponent(input.sessionId)}`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }
}

export class ElevenLabsRealtimeProvider implements RealtimeVoiceProvider {
  readonly mode: ProviderMode = "configured";

  constructor(
    private readonly config: {
      apiKey: string;
      agentId: string;
      baseUrl?: string;
    },
  ) {}

  async issueBrowserSession(): Promise<RealtimeVoiceSession> {
    const baseUrl = this.config.baseUrl ?? "https://api.elevenlabs.io";
    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(this.config.agentId)}`,
      {
        headers: {
          "xi-api-key": this.config.apiKey,
        },
      },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`ElevenLabs signed URL request failed${detail ? `: ${detail}` : "."}`);
    }

    const payload = (await response.json()) as { signed_url?: string };
    if (!payload.signed_url) {
      throw new Error("ElevenLabs signed URL response did not include signed_url.");
    }

    return {
      provider: "elevenlabs-browser",
      mode: this.mode,
      sessionToken: createParticipantToken(),
      interviewerModel: "elevenlabs-agent",
      supervisorModel: "frontier-reasoning",
      websocketUrl: payload.signed_url,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }
}
