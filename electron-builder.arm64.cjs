const { build } = require('./package.json')

// Keep the existing Intel packaging command and filename intact.
module.exports = {
  ...build,
  extends: null,
  mac: {
    ...build.mac,
    target: [{ target: 'dmg', arch: ['arm64'] }],
    artifactName: '${productName}-${version}-macOS-AppleSilicon.${ext}'
  }
}
