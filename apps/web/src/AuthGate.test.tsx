import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthGate } from "./AuthGate";

afterEach(() => cleanup());

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
});
