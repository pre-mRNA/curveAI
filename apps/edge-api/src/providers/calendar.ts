import { createParticipantToken } from "../crypto.js";
import type { CalendarConnectionSummary, ProviderMode } from "../models.js";

export interface CalendarAdapter {
  readonly mode: ProviderMode;
  startAuth(input: {
    sessionId: string;
    inviteCode: string;
    staffName: string;
    publicApiUrl: string;
  }): Promise<CalendarConnectionSummary>;
  completeAuth(input: {
    state: string;
    code?: string;
    accountEmail?: string;
    calendarLabel?: string;
  }): Promise<CalendarConnectionSummary>;
}

export class MockMicrosoftCalendarAdapter implements CalendarAdapter {
  readonly mode: ProviderMode;

  constructor(
    private readonly config: {
      clientId?: string;
      tenantId?: string;
      clientSecret?: string;
      redirectUri?: string;
      graphBaseUrl?: string;
    } = {},
  ) {
    this.mode =
      this.config.clientId && this.config.clientSecret && this.config.redirectUri ? "configured" : "mock";
  }

  async startAuth(input: {
    sessionId: string;
    inviteCode: string;
    staffName: string;
    publicApiUrl: string;
  }): Promise<CalendarConnectionSummary> {
    const state = createParticipantToken();
    const callbackUrl =
      this.config.redirectUri ??
      `${input.publicApiUrl.replace(/\/$/, "")}/onboarding/calendar/microsoft/callback`;
    const authUrl =
      this.mode === "configured"
        ? `https://login.microsoftonline.com/${encodeURIComponent(this.config.tenantId ?? "common")}/oauth2/v2.0/authorize?client_id=${encodeURIComponent(this.config.clientId ?? "")}&response_type=code&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${encodeURIComponent("openid profile email offline_access User.Read Calendars.ReadWrite")}&state=${encodeURIComponent(state)}`
        : `${callbackUrl}?state=${encodeURIComponent(state)}&code=mock-code&email=${encodeURIComponent(`${slugify(input.staffName)}@example.com`)}&calendar=${encodeURIComponent(`${input.staffName} Calendar`)}&invite=${encodeURIComponent(input.inviteCode)}`;

    return {
      provider: "microsoft",
      mode: this.mode,
      status: "pending",
      authUrl,
      authState: state,
    };
  }

  async completeAuth(input: {
    state: string;
    code?: string;
    accountEmail?: string;
    calendarLabel?: string;
  }): Promise<CalendarConnectionSummary> {
    if (this.mode === "configured") {
      if (!input.code) {
        throw new Error("Microsoft authorization code is required.");
      }

      const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(this.config.tenantId ?? "common")}/oauth2/v2.0/token`;
      const tokenBody = new URLSearchParams({
        client_id: this.config.clientId ?? "",
        client_secret: this.config.clientSecret ?? "",
        code: input.code,
        grant_type: "authorization_code",
        redirect_uri: this.config.redirectUri ?? "",
      });

      const tokenResponse = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: tokenBody.toString(),
      });
      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text().catch(() => "");
        throw new Error(`Microsoft token exchange failed${errorText ? `: ${errorText}` : "."}`);
      }

      const tokenPayload = (await tokenResponse.json()) as { access_token?: string };
      if (!tokenPayload.access_token) {
        throw new Error("Microsoft token exchange returned no access token.");
      }

      const graphBaseUrl = this.config.graphBaseUrl ?? "https://graph.microsoft.com";
      const headers = { authorization: `Bearer ${tokenPayload.access_token}` };

      const profileResponse = await fetch(`${graphBaseUrl}/v1.0/me?$select=mail,userPrincipalName,displayName`, {
        headers,
      });
      if (!profileResponse.ok) {
        const errorText = await profileResponse.text().catch(() => "");
        throw new Error(`Microsoft profile lookup failed${errorText ? `: ${errorText}` : "."}`);
      }

      const profile = (await profileResponse.json()) as {
        mail?: string;
        userPrincipalName?: string;
      };

      let calendarLabel = "Primary";
      const calendarResponse = await fetch(`${graphBaseUrl}/v1.0/me/calendar?$select=name`, { headers });
      if (calendarResponse.ok) {
        const calendar = (await calendarResponse.json()) as { name?: string };
        if (calendar.name) {
          calendarLabel = calendar.name;
        }
      }

      return {
        provider: "microsoft",
        mode: this.mode,
        status: "connected",
        accountEmail: profile.mail ?? profile.userPrincipalName ?? input.accountEmail,
        calendarLabel,
        connectedAt: new Date().toISOString(),
      };
    }

    return {
      provider: "microsoft",
      mode: this.mode,
      status: "connected",
      authState: input.state,
      accountEmail: input.accountEmail ?? "connected@example.com",
      calendarLabel: input.calendarLabel ?? "Primary",
      connectedAt: new Date().toISOString(),
    };
  }
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
}
