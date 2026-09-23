import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";

vi.mock("../components/AuthProvider", () => ({
  useAuth: () => ({
    user: null,
    login: vi.fn(),
    signup: vi.fn(),
    googleLogin: vi.fn(),
  }),
}));

describe("LoginPage", () => {
  it("starts with empty credentials and supports password-manager autofill", () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>);

    const email = screen.getByLabelText("Email or mobile number");
    const password = screen.getByLabelText("Password");
    expect(email).toHaveValue("");
    expect(email).toHaveAttribute("autocomplete", "username");
    expect(password).toHaveValue("");
    expect(password).toHaveAttribute("autocomplete", "current-password");
  });
});
