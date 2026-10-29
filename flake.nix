{
  description = "copilot-forms development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAll =
        f:
        nixpkgs.lib.genAttrs systems (
          system:
          f (
            import nixpkgs {
              inherit system;
              config.allowUnfreePredicate = pkg: nixpkgs.lib.getName pkg == "vscode";
            }
          )
        );
    in
    {
      devShells = forAll (
        pkgs:
        let
          fonts = pkgs.makeFontsConf {
            fontDirectories = [
              pkgs.noto-fonts
              pkgs.noto-fonts-cjk-sans
            ];
          };
          base = {
            packages = [
              pkgs.nodejs_22
              pkgs.pnpm_12
              pkgs.git
            ];
            env = {
              PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
              PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
              PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "1";
              PLAYWRIGHT_NIX_VERSION = pkgs.playwright-driver.version;
              FONTCONFIG_FILE = "${fonts}";
            };
          };
        in
        {
          default = pkgs.mkShellNoCC base;
          acceptance = pkgs.mkShellNoCC {
            packages =
              base.packages
              ++ [ pkgs.vscode ]
              ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.xvfb-run ];
            env = base.env // {
              VSCODE_EXECUTABLE = "${pkgs.vscode}/bin/code";
            };
          };
        }
      );

      formatter = forAll (pkgs: pkgs.nixfmt);
    };
}
