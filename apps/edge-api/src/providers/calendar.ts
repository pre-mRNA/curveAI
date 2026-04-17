import { createParticipantToken } from "../crypto.js";
import type { CalendarConnectionSummary, ProviderMode } from "../models.js";

export interface CalendarCredentialRecord {
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
}

export interface CalendarAuthCompletion {
  summary: CalendarConnectionSummary;
  credential?: CalendarCredentialRecord;
}

export interface CalendarEventResult {
  eventId: string;
  provider: string;
  mode: ProviderMode;
  status: "booked";
  calendarId?: string;
  calendarLabel?: string;
  accountEmail?: string;
  webLink?: string;
  credential?: CalendarCredentialRecord;
}

export interface CalendarAdapter {
  readonly mode: ProviderMode;
  startAuth(input: {
    staffName: string;
    publicApiUrl: string;
    redirectUri?: string;
  }): Promise<CalendarConnectionSummary>;
  completeAuth(input: {
    state: string;
    code?: string;
    accountEmail?: string;
    calendarLabel?: string;
    redirectUri?: string;
  }): Promise<CalendarAuthCompletion>;
  createEvent(input: {
    staffName: string;
    startAt: string;
    endAt?: string;
    timezone?: string;
    location?: string;
    notes?: string;
    subject: string;
    accountEmail?: string;
    calendarId?: string;
    calendarLabel?: string;
    accessToken?: string;
    refreshToken?: string;
    tokenExpiresAt?: string;
  }): Promise<CalendarEventResult>;
}

type MockMicrosoftIdentity = {
  accountEmail: string;
  calendarId?: string;
  calendarLabel: string;
  displayName?: string;
};

type MicrosoftTokenPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

const MICROSOFT_MOCK_CODE_PREFIX = "mock-code|";
const MICROSOFT_MOCK_TOKEN_PREFIX = "mock-token|";

export class MockMicrosoftCalendarAdapter implements CalendarAdapter {
  readonly mode: ProviderMode;

  constructor(
    private readonly config: {
      clientId?: string;
      tenantId?: string;
      clientSecret?: string;
      redirectUri?: string;
      authBaseUrl?: string;
      graphBaseUrl?: string;
    } = {},
  ) {
    this.mode =
      this.config.clientId && this.config.clientSecret && this.config.redirectUri ? "configured" : "mock";
  }

  async startAuth(input: {
    staffName: string;
    publicApiUrl: string;
    redirectUri?: string;
  }): Promise<CalendarConnectionSummary> {
    const state = createParticipantToken();
    const callbackUrl =
      input.redirectUri ??
      this.config.redirectUri ??
      `${input.publicApiUrl.replace(/\/$/, "")}/onboarding/calendar/microsoft/callback`;
    const mockIdentity = defaultMockMicrosoftIdentity(input.staffName);
    const authUrl =
      this.mode === "configured"
        ? `${this.authorizationBaseUrl()}/authorize?client_id=${encodeURIComponent(this.config.clientId ?? "")}&response_type=code&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${encodeURIComponent("openid profile email offline_access User.Read Calendars.ReadWrite")}&state=${encodeURIComponent(state)}&staff_name=${encodeURIComponent(input.staffName)}`
        : `${input.publicApiUrl.replace(/\/$/, "")}/mock/providers/microsoft/authorize?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(callbackUrl)}&staff_name=${encodeURIComponent(input.staffName)}&email=${encodeURIComponent(mockIdentity.accountEmail)}&calendar=${encodeURIComponent(mockIdentity.calendarLabel)}&calendar_id=${encodeURIComponent(mockIdentity.calendarId ?? "primary")}`;

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
    redirectUri?: string;
  }): Promise<CalendarAuthCompletion> {
    if (this.mode === "configured") {
      if (!input.code) {
        throw new Error("Microsoft authorization code is required.");
      }

      const tokenPayload = await this.exchangeToken({
        grantType: "authorization_code",
        code: input.code,
        redirectUri: input.redirectUri,
      });
      if (!tokenPayload.access_token) {
        throw new Error("Microsoft token exchange returned no access token.");
      }

      const graphBaseUrl = this.graphBaseUrl();
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

      let calendarId: string | undefined;
      let calendarLabel = "Primary";
      const calendarResponse = await fetch(`${graphBaseUrl}/v1.0/me/calendar?$select=id,name`, { headers });
      if (calendarResponse.ok) {
        const calendar = (await calendarResponse.json()) as { id?: string; name?: string };
        if (calendar.id) {
          calendarId = calendar.id;
        }
        if (calendar.name) {
          calendarLabel = calendar.name;
        }
      }

      return {
        summary: {
          provider: "microsoft",
          mode: this.mode,
          status: "connected",
          accountEmail: profile.mail ?? profile.userPrincipalName ?? input.accountEmail,
          calendarId,
          calendarLabel,
          connectedAt: new Date().toISOString(),
        },
        credential: {
          accessToken: tokenPayload.access_token,
          refreshToken: tokenPayload.refresh_token,
          tokenExpiresAt: toTokenExpiry(tokenPayload.expires_in),
        },
      };
    }

    return {
      summary: {
        provider: "microsoft",
        mode: this.mode,
        status: "connected",
        authState: input.state,
        accountEmail: input.accountEmail ?? "connected@example.com",
        calendarId: "primary",
        calendarLabel: input.calendarLabel ?? "Primary",
        connectedAt: new Date().toISOString(),
      },
      credential: undefined,
    };
  }

  async createEvent(input: {
    staffName: string;
    startAt: string;
    endAt?: string;
    timezone?: string;
    location?: string;
    notes?: string;
    subject: string;
    accountEmail?: string;
    calendarId?: string;
    calendarLabel?: string;
    accessToken?: string;
    refreshToken?: string;
    tokenExpiresAt?: string;
  }): Promise<CalendarEventResult> {
    if (this.mode === "configured") {
      const resolvedCredential = await this.resolveCredential(input);
      if (!resolvedCredential.accessToken) {
        throw new Error("Microsoft calendar connection is missing an access token.");
      }

      const graphBaseUrl = this.graphBaseUrl();
      const targetPath = input.calendarId
        ? `/v1.0/me/calendars/${encodeURIComponent(input.calendarId)}/events`
        : "/v1.0/me/events";
      const response = await fetch(`${graphBaseUrl}${targetPath}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${resolvedCredential.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          subject: input.subject,
          start: {
            dateTime: input.startAt,
            timeZone: input.timezone ?? "UTC",
          },
          ...(input.endAt
            ? {
                end: {
                  dateTime: input.endAt,
                  timeZone: input.timezone ?? "UTC",
                },
              }
            : {}),
          ...(input.location ? { location: { displayName: input.location } } : {}),
          ...(input.notes
            ? {
                body: {
                  contentType: "text",
                  content: input.notes,
                },
              }
            : {}),
        }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Microsoft event creation failed${detail ? `: ${detail}` : "."}`);
      }
      const payload = (await response.json()) as { id?: string; webLink?: string };
      if (!payload.id) {
        throw new Error("Microsoft event creation returned no id.");
      }

      return {
        eventId: payload.id,
        provider: "microsoft-calendar",
        mode: this.mode,
        status: "booked",
        calendarId: input.calendarId,
        calendarLabel: input.calendarLabel,
        accountEmail: input.accountEmail,
        webLink: payload.webLink,
        credential: resolvedCredential.updated
          ? {
              accessToken: resolvedCredential.accessToken,
              refreshToken: resolvedCredential.refreshToken,
              tokenExpiresAt: resolvedCredential.tokenExpiresAt,
            }
          : undefined,
      };
    }

    return {
      eventId: `event_${createParticipantToken().slice(0, 12)}`,
      provider: "microsoft-calendar",
      mode: this.mode,
      status: "booked",
      calendarId: input.calendarId ?? "primary",
      calendarLabel: input.calendarLabel ?? `${input.staffName} Calendar`,
      accountEmail: input.accountEmail,
      webLink: `https://mock.microsoft.local/events/${encodeURIComponent(input.subject)}`,
    };
  }

  private async resolveCredential(input: {
    accessToken?: string;
    refreshToken?: string;
    tokenExpiresAt?: string;
  }): Promise<{
    accessToken?: string;
    refreshToken?: string;
    tokenExpiresAt?: string;
    updated: boolean;
  }> {
    const hasLiveToken = input.accessToken && !isTokenExpired(input.tokenExpiresAt);
    if (hasLiveToken) {
      return {
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        tokenExpiresAt: input.tokenExpiresAt,
        updated: false,
      };
    }
    if (!input.refreshToken) {
      return {
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        tokenExpiresAt: input.tokenExpiresAt,
        updated: false,
      };
    }
      const refreshed = await this.exchangeToken({
        grantType: "refresh_token",
        refreshToken: input.refreshToken,
        redirectUri: this.config.redirectUri,
      });
    if (!refreshed.access_token) {
      throw new Error("Microsoft refresh exchange returned no access token.");
    }
    return {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ?? input.refreshToken,
      tokenExpiresAt: toTokenExpiry(refreshed.expires_in),
      updated: true,
    };
  }

  private async exchangeToken(input: {
    grantType: "authorization_code" | "refresh_token";
    code?: string;
    refreshToken?: string;
    redirectUri?: string;
  }): Promise<MicrosoftTokenPayload> {
    const tokenUrl = `${this.authorizationBaseUrl()}/token`;
    const tokenBody = new URLSearchParams({
      client_id: this.config.clientId ?? "",
      client_secret: this.config.clientSecret ?? "",
      grant_type: input.grantType,
      redirect_uri: input.redirectUri ?? this.config.redirectUri ?? "",
      ...(input.grantType === "authorization_code"
        ? { code: input.code ?? "" }
        : { refresh_token: input.refreshToken ?? "" }),
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

    return (await tokenResponse.json()) as MicrosoftTokenPayload;
  }

  private authorizationBaseUrl(): string {
    if (this.config.authBaseUrl) {
      return this.config.authBaseUrl.replace(/\/$/, "");
    }
    return `https://login.microsoftonline.com/${encodeURIComponent(this.config.tenantId ?? "common")}/oauth2/v2.0`;
  }

  private graphBaseUrl(): string {
    return (this.config.graphBaseUrl ?? "https://graph.microsoft.com").replace(/\/$/, "");
  }
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
}

function toTokenExpiry(expiresIn?: number): string | undefined {
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    return undefined;
  }
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

function isTokenExpired(tokenExpiresAt?: string): boolean {
  if (!tokenExpiresAt) {
    return false;
  }
  return Date.parse(tokenExpiresAt) <= Date.now() + 60_000;
}

export function defaultMockMicrosoftIdentity(staffName: string): MockMicrosoftIdentity {
  const trimmedName = staffName.trim();
  return {
    accountEmail: `${slugify(trimmedName || "staff") || "staff"}@example.com`,
    calendarId: "primary",
    calendarLabel: `${trimmedName || "Primary"} Calendar`,
    displayName: trimmedName || "Curve AI Staff",
  };
}

export function createMockMicrosoftAuthorizationCode(identity: MockMicrosoftIdentity): string {
  return `${MICROSOFT_MOCK_CODE_PREFIX}${encodeURIComponent(identity.accountEmail)}|${encodeURIComponent(identity.calendarId ?? "primary")}|${encodeURIComponent(identity.calendarLabel)}|${encodeURIComponent(identity.displayName ?? "")}`;
}

export function parseMockMicrosoftAuthorizationCode(code?: string): MockMicrosoftIdentity | undefined {
  if (!code?.startsWith(MICROSOFT_MOCK_CODE_PREFIX)) {
    return undefined;
  }
  const [accountEmail, calendarId, calendarLabel, displayName = ""] = code
    .slice(MICROSOFT_MOCK_CODE_PREFIX.length)
    .split("|")
    .map((value) => decodeURIComponent(value));
  if (!accountEmail || !calendarLabel) {
    return undefined;
  }
  return {
    accountEmail,
    calendarId: calendarId || undefined,
    calendarLabel,
    displayName: displayName || undefined,
  };
}

export function createMockMicrosoftAccessToken(identity: MockMicrosoftIdentity): string {
  return `${MICROSOFT_MOCK_TOKEN_PREFIX}${encodeURIComponent(identity.accountEmail)}|${encodeURIComponent(identity.calendarId ?? "primary")}|${encodeURIComponent(identity.calendarLabel)}|${encodeURIComponent(identity.displayName ?? "")}`;
}

export function parseMockMicrosoftAccessToken(token?: string): MockMicrosoftIdentity | undefined {
  if (!token?.startsWith(MICROSOFT_MOCK_TOKEN_PREFIX)) {
    return undefined;
  }
  const [accountEmail, calendarId, calendarLabel, displayName = ""] = token
    .slice(MICROSOFT_MOCK_TOKEN_PREFIX.length)
    .split("|")
    .map((value) => decodeURIComponent(value));
  if (!accountEmail || !calendarLabel) {
    return undefined;
  }
  return {
    accountEmail,
    calendarId: calendarId || undefined,
    calendarLabel,
    displayName: displayName || undefined,
  };
}
