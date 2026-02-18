import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "./App";

test("renders app without crashing", () => {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <App />
    </MemoryRouter>,
  );
});
