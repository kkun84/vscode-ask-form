export type ThemeName = "dark" | "light" | "highContrast"

const palette = {
  dark: {
    "--color-text-primary": "#cccccc",
    "--color-text-secondary": "#9d9d9d",
    "--color-background-primary": "#1f1f1f",
    "--color-background-secondary": "#181818",
    "--color-border-primary": "#2b2b2b",
    "--color-border-secondary": "#3c3c3c",
    "--color-text-info": "#4daafc",
    "--color-text-danger": "#f48771",
    "--color-text-success": "#73c991",
    "--color-ring-primary": "#0078d4",
    "--vscode-button-background": "#0078d4",
    "--vscode-button-foreground": "#ffffff",
    "--vscode-input-background": "#313131",
    "--vscode-input-border": "#3c3c3c"
  },
  light: {
    "--color-text-primary": "#3b3b3b",
    "--color-text-secondary": "#616161",
    "--color-background-primary": "#ffffff",
    "--color-background-secondary": "#f8f8f8",
    "--color-border-primary": "#e5e5e5",
    "--color-border-secondary": "#cecece",
    "--color-text-info": "#005fb8",
    "--color-text-danger": "#c72e0f",
    "--color-text-success": "#2d7d46",
    "--color-ring-primary": "#005fb8",
    "--vscode-button-background": "#005fb8",
    "--vscode-button-foreground": "#ffffff",
    "--vscode-input-background": "#ffffff",
    "--vscode-input-border": "#cecece"
  },
  highContrast: {
    "--color-text-primary": "#ffffff",
    "--color-text-secondary": "#ffffff",
    "--color-background-primary": "#000000",
    "--color-background-secondary": "#000000",
    "--color-border-primary": "#6fc3df",
    "--color-border-secondary": "#6fc3df",
    "--color-text-info": "#21a6ff",
    "--color-text-danger": "#f48771",
    "--color-text-success": "#89d185",
    "--color-ring-primary": "#f38518",
    "--vscode-button-background": "#000000",
    "--vscode-button-foreground": "#ffffff",
    "--vscode-input-background": "#000000",
    "--vscode-input-border": "#6fc3df"
  }
} as const

export const themeContext = (name: ThemeName) => ({
  theme: name === "light" ? ("light" as const) : ("dark" as const),
  styles: { variables: palette[name] }
})
