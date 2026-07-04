import { render } from "preact";
import { Router } from "./router";
import "./styles/theme.css";
import "./styles/blog.css";

const root = document.getElementById("app");
if (!root) throw new Error("missing #app");
render(<Router />, root);
