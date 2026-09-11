import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "./App";
import { ToastProvider } from "./Toast";

jest.mock("./UserManual", () => () => <div>用户手册</div>);

test("renders app without crashing", () => {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </MemoryRouter>,
  );
});
