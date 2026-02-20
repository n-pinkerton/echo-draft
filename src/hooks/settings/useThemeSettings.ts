import { useLocalStorage } from "../useLocalStorage";

export function useThemeSettings() {
  const [theme, setTheme] = useLocalStorage<"light" | "dark" | "auto">("theme", "auto", {
    serialize: String,
    deserialize: (value) => {
      if (["light", "dark", "auto"].includes(value)) return value as "light" | "dark" | "auto";
      return "auto";
    },
  });

  return { theme, setTheme };
}

