import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "./App";
import { ToastProvider } from "./Toast";

test("renders app without crashing", () => {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </MemoryRouter>,
  );
});
