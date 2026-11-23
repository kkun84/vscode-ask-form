{
  description = "ask-form development environment";

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
          vscode = pkgs.vscode.overrideAttrs (_: rec {
            version = "1.147.0";
            src = pkgs.fetchurl {
              name = "VSCode_${version}_${platform}.${archive}";
              url = "https://update.code.visualstudio.com/${version}/${platform}/stable";
              hash =
                {
                  x86_64-linux = "sha256-b9ixRgDyqN24tIM9i/KI89xMNLKHjSxsP+x+FsgQI7w=";
                  aarch64-linux = "sha256-sTf1Oimh3r+fwwAngjVWhjIC+UwQ2STdcPLSNweVQS0=";
                  aarch64-darwin = "sha256-FJ2UT+tZmwdrSEBrF04cPNHVEOnWc4VHd6IKb0EWpZo=";
                }
                .${pkgs.stdenv.hostPlatform.system};
            };
            platform =
              {
                x86_64-linux = "linux-x64";
                aarch64-linux = "linux-arm64";
                aarch64-darwin = "darwin-arm64";
              }
              .${pkgs.stdenv.hostPlatform.system};
            archive = if pkgs.stdenv.hostPlatform.isDarwin then "zip" else "tar.gz";
          });
          fonts = pkgs.writeText "fonts.conf" ''
            <?xml version="1.0"?>
            <!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
            <fontconfig>
              <include ignore_missing="yes">${pkgs.fontconfig.out}/etc/fonts/conf.d</include>
              <dir>${pkgs.noto-fonts}</dir>
              <dir>${pkgs.noto-fonts-cjk-sans}</dir>
              <cachedir prefix="xdg">fontconfig</cachedir>
            </fontconfig>
          '';
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
              ++ [
                vscode
                pkgs.ffmpeg-headless
              ]
              ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.xvfb-run ];
            env =
              base.env
              // {
                VSCODE_EXECUTABLE = "${vscode}/bin/code";
                ASK_FORM_OPENSSH = "${pkgs.openssh}";
                VSCODE_ELECTRON =
                  if pkgs.stdenv.hostPlatform.isDarwin then
                    "${vscode}/Applications/Visual Studio Code.app/Contents/MacOS/Code"
                  else
                    "${vscode}/lib/vscode/code";
              }
              // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
                ASK_FORM_OPENSSL_LIB = pkgs.lib.makeLibraryPath [ pkgs.openssl ];
              };
          };
        }
      );

      formatter = forAll (pkgs: pkgs.nixfmt);
    };
}
