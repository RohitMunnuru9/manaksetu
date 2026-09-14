import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#14231D",
        pine: "#173F32",
        saffron: "#F59E42",
        mist: "#F1F4ED",
      },
      boxShadow: {
        panel: "0 18px 55px rgba(23, 63, 50, 0.10)",
      },
      animation: {
        "fade-up": "fadeUp .55s ease-out both",
        "soft-pulse": "softPulse 2.5s ease-in-out infinite",
      },
      keyframes: {
        fadeUp: {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        softPulse: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(245,158,66,0)" },
          "50%": { boxShadow: "0 0 0 7px rgba(245,158,66,.12)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
