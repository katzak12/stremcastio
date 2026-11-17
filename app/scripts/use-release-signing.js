// Switches the generated android/app/build.gradle from the debug keystore to
// a real release keystore (values come from android/gradle.properties).
// Used by CI only when the ANDROID_KEYSTORE_* secrets are set.
const fs = require('fs')
const path = require('path')

const file = path.join(__dirname, '..', 'android', 'app', 'build.gradle')
let gradle = fs.readFileSync(file, 'utf8')

const releaseConfig = `
        release {
            storeFile file(STREMCASTIO_STORE_FILE)
            storePassword STREMCASTIO_STORE_PASSWORD
            keyAlias STREMCASTIO_KEY_ALIAS
            keyPassword STREMCASTIO_KEY_PASSWORD
        }`

if (!gradle.includes('STREMCASTIO_STORE_FILE')) {
  gradle = gradle.replace(/signingConfigs \{\n(\s+debug \{[\s\S]*?\n\s+\})/, (m) => m + releaseConfig)
  gradle = gradle.replace(
    /(release \{\n(?:\s*\/\/.*\n)*\s*)signingConfig signingConfigs\.debug/,
    '$1signingConfig signingConfigs.release',
  )
}
if (!gradle.includes('signingConfig signingConfigs.release')) {
  throw new Error('Could not patch build.gradle for release signing')
}
fs.writeFileSync(file, gradle)
console.log('Release signing enabled')
