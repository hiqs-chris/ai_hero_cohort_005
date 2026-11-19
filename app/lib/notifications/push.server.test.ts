import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sendNotification, WebPushError } from "web-push";
import type { SendResult } from "web-push";
import {
  defaultPushTransport,
  vapidFromEnv,
  webPushTransport,
  type PushPayload,
} from "./push.server";

// web-push stays real for its WebPushError shape, but its sender is mocked so
// the default wiring can be observed without a network call.

vi.mock("web-push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("web-push")>();
  return { ...actual, sendNotification: vi.fn() };
});

const vapid = {
  subject: "mailto:hello@cadence.dev",
  publicKey: "public-key",
  privateKey: "private-key",
};

function subscription() {
  return {
    endpoint: "https://push.example/device/1",
    p256dh: "p256dh-key",
    auth: "auth-key",
  };
}

function payload(): PushPayload {
  return {
    title: "Refund request raised",
    body: "Test Course · $79.00",
    url: "https://cadence.test/admin/refunds",
    notificationId: 42,
  };
}

function ok(): SendResult {
  return { statusCode: 200, body: "", headers: {} };
}

beforeEach(() => {
  vi.mocked(sendNotification).mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("webPushTransport", () => {
  it("sends the payload as JSON with per-call VAPID details and reports 200", async () => {
    const send = vi.fn(async () => ok());
    const transport = webPushTransport(vapid, send);

    await expect(transport.send(subscription(), payload())).resolves.toEqual({
      status: 200,
    });

    expect(send).toHaveBeenCalledWith(
      {
        endpoint: "https://push.example/device/1",
        keys: { p256dh: "p256dh-key", auth: "auth-key" },
      },
      JSON.stringify(payload()),
      { vapidDetails: vapid }
    );
  });

  it("maps a WebPushError's status, so 404 and 410 read as gone subscriptions", async () => {
    for (const statusCode of [404, 410]) {
      const send = vi.fn(async () => {
        throw new WebPushError(
          "Subscription gone",
          statusCode,
          {},
          "",
          "https://push.example/device/1"
        );
      });
      const transport = webPushTransport(vapid, send);

      await expect(transport.send(subscription(), payload())).resolves.toEqual({
        status: statusCode,
      });
    }
  });

  it("logs any other error and reports 500", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn(async () => {
      throw new Error("push service is down");
    });
    const transport = webPushTransport(vapid, send);

    await expect(transport.send(subscription(), payload())).resolves.toEqual({
      status: 500,
    });

    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("vapidFromEnv", () => {
  it("collects every VAPID variable", () => {
    expect(
      vapidFromEnv({
        VAPID_SUBJECT: "mailto:hello@cadence.dev",
        VAPID_PUBLIC_KEY: "public-key",
        VAPID_PRIVATE_KEY: "private-key",
      })
    ).toEqual(vapid);
  });

  it("is null unless every variable is set", () => {
    const full = {
      VAPID_SUBJECT: "mailto:hello@cadence.dev",
      VAPID_PUBLIC_KEY: "public-key",
      VAPID_PRIVATE_KEY: "private-key",
    };
    for (const key of Object.keys(full)) {
      expect(vapidFromEnv({ ...full, [key]: undefined })).toBeNull();
    }
  });
});

describe("defaultPushTransport", () => {
  it("sends through web-push when every VAPID variable is set", async () => {
    vi.stubEnv("VAPID_SUBJECT", "mailto:hello@cadence.dev");
    vi.stubEnv("VAPID_PUBLIC_KEY", "public-key");
    vi.stubEnv("VAPID_PRIVATE_KEY", "private-key");
    vi.mocked(sendNotification).mockResolvedValue(ok());

    const transport = defaultPushTransport();

    await expect(transport.send(subscription(), payload())).resolves.toEqual({
      status: 200,
    });
    expect(sendNotification).toHaveBeenCalledWith(
      {
        endpoint: "https://push.example/device/1",
        keys: { p256dh: "p256dh-key", auth: "auth-key" },
      },
      JSON.stringify(payload()),
      { vapidDetails: vapid }
    );
  });

  it("falls back to the no-op when a VAPID variable is missing", async () => {
    vi.stubEnv("VAPID_SUBJECT", "mailto:hello@cadence.dev");
    vi.stubEnv("VAPID_PUBLIC_KEY", "public-key");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const transport = defaultPushTransport();

    await expect(transport.send(subscription(), payload())).resolves.toEqual({
      status: 200,
    });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[push:noop]"));
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
