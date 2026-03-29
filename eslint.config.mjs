import nextConfig from "eslint-config-next/core-web-vitals"
import prettier from "eslint-config-prettier"

const eslintConfig = [
  { ignores: [".next/**", "coverage/**", "out/**"] },
  ...nextConfig,
  {
    rules: {
      "no-unused-vars": "warn",
      "prefer-const": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // shadcn/ui generated components — not hand-authored, skip strict hooks rules
  {
    files: ["components/ui/**"],
    rules: {
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  prettier,
]

export default eslintConfig
