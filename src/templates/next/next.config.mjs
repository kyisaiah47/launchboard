// launchboard reads files and runs `launchctl list`, so it stays a Node package on the server and
// is never bundled.
const config = {
  serverExternalPackages: ['launchboard'],
  poweredByHeader: false,
};

export default config;
