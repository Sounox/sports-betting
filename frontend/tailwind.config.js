/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#eefbf3",
          100: "#d6f5e3",
          500: "#16a34a",
          600: "#15803d",
          700: "#166534",
        },
        value: "#16a34a",
        risk: "#dc2626",
        warn: "#d97706",
      },
    },
  },
  plugins: [],
};
