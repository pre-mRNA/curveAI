import { createParticipantToken } from "../crypto.js";
import type { ProviderMode } from "../models.js";

export interface MessageDeliveryResult {
  provider: string;
  mode: ProviderMode;
  messageId: string;
  status: string;
  to: string;
}

export interface MessagingProvider {
  readonly mode: ProviderMode;
  sendText(input: { to: string; body: string }): Promise<MessageDeliveryResult>;
}

export class MockMessagingProvider implements MessagingProvider {
  readonly mode: ProviderMode = "mock";

  async sendText(input: { to: string; body: string }): Promise<MessageDeliveryResult> {
    return {
      provider: "twilio-sms",
      mode: this.mode,
      messageId: `msg_${createParticipantToken().slice(0, 12)}`,
      status: "queued",
      to: input.to,
    };
  }
}

export class TwilioMessagingProvider implements MessagingProvider {
  readonly mode: ProviderMode = "configured";

  constructor(
    private readonly config: {
      accountSid: string;
      authToken: string;
      fromNumber: string;
      baseUrl?: string;
    },
  ) {}

  async sendText(input: { to: string; body: string }): Promise<MessageDeliveryResult> {
    const baseUrl = this.config.baseUrl ?? "https://api.twilio.com";
    const endpoint = `${baseUrl.replace(/\/$/, "")}/2010-04-01/Accounts/${encodeURIComponent(this.config.accountSid)}/Messages.json`;
    const body = new URLSearchParams({
      To: input.to,
      From: this.config.fromNumber,
      Body: input.body,
    });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${this.config.accountSid}:${this.config.authToken}`)}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Twilio SMS request failed${detail ? `: ${detail}` : "."}`);
    }

    const payload = (await response.json()) as { sid?: string; status?: string; to?: string };
    if (!payload.sid) {
      throw new Error("Twilio SMS response did not include a sid.");
    }

    return {
      provider: "twilio-sms",
      mode: this.mode,
      messageId: payload.sid,
      status: payload.status ?? "queued",
      to: payload.to ?? input.to,
    };
  }
}
