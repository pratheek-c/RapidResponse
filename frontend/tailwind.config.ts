import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        command: {
          bg: "#0a0f1e",
          panel: "#0f172a",
          card: "#1e293b",
          text: "#e2e8f0",
          muted: "#94a3b8",
        },
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(148, 163, 184, 0.18), 0 10px 30px rgba(15, 23, 42, 0.35)",
      },
    },
  },
  plugins: [],
};

export default config;
