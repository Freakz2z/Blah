import { createRoot } from "react-dom/client";
import Home from "./src/Home";
import "./src/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("Toy root element is missing");

createRoot(root).render(<Home />);
