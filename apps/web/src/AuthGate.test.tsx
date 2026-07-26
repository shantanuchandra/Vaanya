import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { AuthGate } from "./AuthGate";
import { getEncounter, setAccessTokenProvider } from "./api";

afterEach(() => {
  cleanup();
  setAccessTokenProvider(async () => null);
  vi.unstubAllGlobals();
});

describe("clinician sign in", () => {
  it("signs in with the supplied clinician account before revealing the workspace", async () => {
    const signIn = vi.fn().mockResolvedValue({ error: null });
    const user = userEvent.setup();

    render(
      <AuthGate
        auth={{
          getSession: async () => null,
          signIn,
          signOut: async () => undefined,
          onChange: () => () => undefined
        }}
      >
        <p>PAC workspace</p>
      </AuthGate>
    );

    expect(screen.queryByText("PAC workspace")).not.toBeInTheDocument();
    await user.type(
      await screen.findByLabelText(/clinician email/i),
      "doctor@example.com"
    );
    await user.type(screen.getByLabelText(/password/i), "secret-password");
    await user.click(screen.getByRole("button", { name: /open review workspace/i }));

    expect(signIn).toHaveBeenCalledWith(
      "doctor@example.com",
      "secret-password"
    );
  });

  it("installs the access token before authenticated children request data", async () => {
    let notify: (session: {
      accessToken: string;
      email: string;
    }) => void = () => undefined;
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ message: "not needed" })
    });
    vi.stubGlobal("fetch", fetcher);
    function ProtectedChild() {
      useEffect(() => {
        getEncounter("demo").catch(() => undefined);
      }, []);
      return <p>PAC workspace</p>;
    }
    const auth = {
      getSession: async () => null,
      signIn: async () => {
        notify({ accessToken: "fresh-jwt", email: "doctor@example.com" });
        return { error: null };
      },
      signOut: async () => undefined,
      onChange: (listener: typeof notify) => {
        notify = listener;
        return () => undefined;
      }
    };
    const user = userEvent.setup();

    render(
      <AuthGate auth={auth}>
        <ProtectedChild />
      </AuthGate>
    );
    await user.type(
      await screen.findByLabelText(/clinician email/i),
      "doctor@example.com"
    );
    await user.type(screen.getByLabelText(/password/i), "secret-password");
    await user.click(screen.getByRole("button", { name: /open review workspace/i }));
    await screen.findByText("PAC workspace");

    expect(new Headers(fetcher.mock.calls[0]![1].headers).get("authorization"))
      .toBe("Bearer fresh-jwt");
  });
});
